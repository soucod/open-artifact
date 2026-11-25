import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDashboardContent, type Dataset, type DashboardContent } from '@open-artifact/data-core';
import type { DbCapability, DbChangeEvent, DbDocument, DbWrite, JsonRecord, Viewer } from '@open-artifact/runtime';
import { createDataEngine, type DataEngine } from '../src/data/engine.ts';
import { applyFetchPriority } from '../src/data/query-store.ts';
import { createSavedRowsReader } from '../src/data/saved-rows.ts';
import { createPageCapabilities, type PageCapabilityHost, type PageDb } from '../src/page/capabilities.ts';
import { getToolbarKeyTarget } from '@open-artifact/editor-kit';
import { groupSourcesByConnector, hasRefreshAction } from '../src/sources/grouping.ts';

/* ------------------------------------------------------------------ fakes */

interface MemoryDb extends DbCapability {
  docs: Map<string, JsonRecord>;
  /** Someone else changes documents: listeners hear it. */
  remote(changes: Record<string, JsonRecord | null>): void;
  reads: string[];
}

function createMemoryDb(initial: Record<string, JsonRecord> = {}, hold?: () => Promise<void>): MemoryDb {
  const docs = new Map(Object.entries(initial));
  const listeners = new Set<(event: DbChangeEvent) => void>();
  const reads: string[] = [];
  const parent = (path: string): string => path.slice(0, path.lastIndexOf('/'));
  const apply = (changes: Record<string, JsonRecord | null>): void => {
    for (const [path, data] of Object.entries(changes)) {
      if (data === null) docs.delete(path);
      else docs.set(path, data);
    }
  };
  return {
    docs,
    reads,
    async get(path) {
      reads.push(path);
      await hold?.();
      return docs.get(path) ?? null;
    },
    async list(collection) {
      reads.push(collection);
      const listed: DbDocument[] = [...docs]
        .filter(([path]) => parent(path) === collection)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([path, data]) => ({ path, data }));
      await hold?.();
      return listed;
    },
    async write(writes: DbWrite[]) {
      for (const write of writes) {
        if (write.op === 'delete') docs.delete(write.path);
        else if (write.op === 'set') docs.set(write.path, write.data);
        else docs.set(write.path, { ...(docs.get(write.path) ?? {}), ...write.patch });
      }
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    remote(changes) {
      apply(changes);
      for (const listener of [...listeners]) listener({ changes, author: 'agent' });
    },
  };
}

function content(datasets: Record<string, unknown>): DashboardContent {
  return parseDashboardContent({ meta: { title: 'Test' }, params: {}, settings: {}, datasets, files: {} });
}

const store = (path: string) => ({ title: path, source: { kind: 'store', path } });

function engineOn(db: DbCapability | null, viewer = 'u1'): DataEngine {
  return createDataEngine({
    mcp: () => null,
    agent: () => null,
    savedRows: createSavedRowsReader({ db: () => db }),
    viewerId: () => viewer,
    scope: 'test',
  });
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
/** Rows as plain objects, to compare. */
const plain = (rows: readonly object[] | undefined): object[] => (rows ?? []).map((row) => ({ ...row }));

/* ------------------------------------------------------------------ tests */

describe('saved rows reader', () => {
  it('lists a collection, then follows changes without reading again', async () => {
    const db = createMemoryDb({ 'data/team/notes/b': { text: 'two' }, 'data/team/notes/a': { text: 'one' }, 'data/team/other/x': { n: 1 } });
    const reader = createSavedRowsReader({ db: () => db });
    const heard: string[] = [];
    reader.subscribe((path) => heard.push(path));
    const result = await reader.load('data/team/notes');
    assert.ok(result.ok);
    assert.deepEqual(plain(result.table.rows), [
      { text: 'one', id: 'a' },
      { text: 'two', id: 'b' },
    ]);
    db.remote({ 'data/team/notes/c': { text: 'three' }, 'data/team/notes/a': null, 'data/team/other/y': { n: 2 } });
    assert.deepEqual(heard, ['data/team/notes']);
    assert.deepEqual(reader.current('data/team/notes')?.rows.map((row) => row.id), ['b', 'c']);
    assert.deepEqual(db.reads, ['data/team/notes']);
  });

  it('keeps a change that arrives while the first read is out', async () => {
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const db = createMemoryDb({ 'data/team/notes/a': { text: 'old' } }, () => gate);
    const reader = createSavedRowsReader({ db: () => db });
    const loading = reader.load('data/team/notes');
    await tick();
    db.remote({ 'data/team/notes/a': { text: 'new' } });
    release();
    const result = await loading;
    assert.ok(result.ok);
    assert.deepEqual(plain(result.table.rows), [{ text: 'new', id: 'a' }]);
  });

  it('reads one document as one row while it exists', async () => {
    const db = createMemoryDb({ 'data/team/goals/q1': { target: 40 } });
    const reader = createSavedRowsReader({ db: () => db });
    const found = await reader.load('data/team/goals/q1');
    assert.ok(found.ok);
    assert.deepEqual(plain(found.table.rows), [{ target: 40, id: 'q1' }]);
    const missing = await reader.load('data/team/goals/q2');
    assert.ok(missing.ok);
    assert.deepEqual(missing.table.columns, ['id']);
    assert.deepEqual(missing.table.rows, []);
  });

  it('fails in words when the store is missing, slow or refuses', async () => {
    const none = await createSavedRowsReader({ db: () => null }).load('data/team/notes');
    assert.equal(!none.ok && none.wording?.code, 'savedRowsUnavailable');
    const silent = createMemoryDb({}, () => new Promise(() => undefined));
    const late = await createSavedRowsReader({ db: () => silent, timeoutMs: 10 }).load('data/team/notes');
    assert.equal(!late.ok && late.wording?.code, 'savedRowsSilent');
    const broken: DbCapability = { ...createMemoryDb(), list: () => Promise.reject(new Error('down')) };
    const failed = await createSavedRowsReader({ db: () => broken }).load('data/team/notes');
    assert.equal(!failed.ok && failed.wording?.code, 'savedRowsFailed');
  });
});

describe('saved rows in the engine', () => {
  it('gives a store source its rows, then each change as it comes, without loading again', async () => {
    const db = createMemoryDb({ 'data/team/tasks/t1': { done: false } });
    const engine = engineOn(db);
    engine.setContent(content({ tasks: store('data/team/tasks') }));
    assert.equal(engine.read('tasks').status, 'loading');
    await engine.settled();
    assert.deepEqual(engine.read('tasks').rows, [{ done: false, id: 't1' }]);
    const statuses: string[] = [];
    engine.store.subscribe((state) => statuses.push(state.runs.get('tasks')?.status ?? ''));
    db.remote({ 'data/team/tasks/t2': { done: true } });
    await engine.settled();
    assert.deepEqual(engine.read('tasks').rows.map((row) => row.id), ['t1', 't2']);
    assert.ok(!statuses.includes('running'), statuses.join());
    assert.deepEqual(db.reads, ['data/team/tasks']);
  });

  it('reads data/users/me as the viewer’s own folder', async () => {
    const db = createMemoryDb({ 'data/users/u7/ticks': { done: 3 }, 'data/users/u8/ticks': { done: 9 } });
    const engine = engineOn(db, 'u7');
    engine.setContent(content({ ticks: store('data/users/me/ticks') }));
    engine.read('ticks');
    await engine.settled();
    assert.deepEqual(engine.read('ticks').rows, [{ done: 3, id: 'ticks' }]);
  });

  it('starts an empty collection with no rows and only the id column', async () => {
    const engine = engineOn(createMemoryDb());
    engine.setContent(content({ tasks: store('data/team/tasks') }));
    engine.read('tasks');
    await engine.settled();
    const result = engine.read('tasks');
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.columns, ['id']);
    assert.deepEqual(result.rows, []);
  });

  it('catches up with the page’s own writes, which the store doesn’t echo', async () => {
    const db = createMemoryDb();
    const engine = engineOn(db, 'u1');
    engine.setContent(content({ notes: store('data/users/me/notes/items') }));
    engine.read('notes');
    await engine.settled();
    await db.write([{ op: 'set', path: 'data/users/u1/notes/items/n1', data: { text: 'hi' } }]);
    await engine.rereadSaved(['data/users/me/notes/items/n1']);
    await engine.settled();
    assert.deepEqual(engine.read('notes').rows, [{ text: 'hi', id: 'n1' }]);
  });

  it('retries saved rows that failed', async () => {
    let fail = true;
    const db = createMemoryDb({ 'data/team/tasks/t1': { done: true } });
    const flaky: DbCapability = { ...db, list: (path) => (fail ? Promise.reject(new Error('down')) : db.list(path)) };
    const engine = engineOn(flaky);
    engine.setContent(content({ tasks: store('data/team/tasks') }));
    engine.read('tasks');
    await engine.settled();
    assert.equal(engine.read('tasks').status, 'error');
    const dataset = engine.getDataset('tasks') as Dataset;
    assert.equal(hasRefreshAction(dataset, engine.getRun('tasks')), true);
    fail = false;
    engine.retryFailed();
    await engine.settled();
    assert.deepEqual(engine.read('tasks').rows, [{ done: true, id: 't1' }]);
  });

  it('gives a calculation its inputs’ refreshing and truncated states', async () => {
    const docs = Object.fromEntries(Array.from({ length: 1001 }, (_, n) => [`data/team/votes/v${String(n).padStart(4, '0')}`, { n: 1 }]));
    const engine = engineOn(createMemoryDb(docs));
    engine.setContent(content({ votes: store('data/team/votes') }));
    engine.registerCalculation('count', { inputs: ['votes'], fn: (votes: unknown[]) => votes.length });
    engine.read('count');
    await engine.settled();
    const counted = engine.read('count');
    assert.equal(counted.value, 1000);
    assert.equal(counted.truncated, true);
    assert.equal(counted.refreshing, false);
  });

  it('hands a calculation a source’s value when it isn’t rows, and no rows for text', async () => {
    const files: Record<string, string> = { '/_blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': '{"goal": 12}', '/_blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb': 'plain words' };
    const fetcher = (async (input: string | URL | Request) => {
      const path = new URL(String(input), 'http://x').pathname;
      return new Response(files[path] ?? '', { status: path in files ? 200 : 404 });
    }) as typeof fetch;
    const engine = createDataEngine({ mcp: () => null, agent: () => null, fetch: fetcher, base: () => 'http://x/', scope: 'test' });
    engine.setContent(
      content({
        goal: { title: 'Goal', source: { kind: 'file', url: '/_blob/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'goal.json', format: 'json' } },
        words: { title: 'Words', source: { kind: 'file', url: '/_blob/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'words.txt', format: 'text' } },
      }),
    );
    engine.registerCalculation('target', { inputs: ['goal'], fn: (goal: { goal: number }) => goal.goal * 2 });
    engine.registerCalculation('wordRows', { inputs: ['words'], fn: (words: unknown) => (Array.isArray(words) ? words.length : -1) });
    engine.read('target');
    engine.read('wordRows');
    await engine.settled();
    assert.equal(engine.read('target').value, 24);
    assert.equal(engine.read('wordRows').value, 0);
  });
});

describe('the page’s openartifact', () => {
  const viewer: Viewer = { id: 'u1', name: 'Ada', role: 'editor' };
  function pageDbWith(db: MemoryDb, canEdit = true, who: Viewer = viewer): { page: Promise<PageDb>; wrote: string[][] } {
    const wrote: string[][] = [];
    const host: PageCapabilityHost = {
      db: () => db,
      viewer: () => who,
      canEdit: () => canEdit,
      downloads: () => null,
      assets: () => null,
      wrote: (documents) => {
        wrote.push([...documents]);
      },
      newId: () => 'fresh',
    };
    return { page: createPageCapabilities(host).use('db') as Promise<PageDb>, wrote };
  }

  it('adds a row with a new ID under the viewer’s own folder and says what it wrote', async () => {
    const db = createMemoryDb();
    const { page, wrote } = pageDbWith(db);
    const path = await (await page).add('data/users/me/notes/items', { text: 'hello' });
    assert.equal(path, 'data/users/u1/notes/items/fresh');
    assert.deepEqual(db.docs.get(path), { text: 'hello' });
    assert.deepEqual(wrote, [['data/users/u1/notes/items/fresh']]);
  });

  it('keeps to saved rows: other paths and the page’s own reports are refused', async () => {
    const db = createMemoryDb({ 'elements/e1': { x: 1 } });
    const pageDb = await pageDbWith(db).page;
    await assert.rejects(pageDb.get('elements/e1'), TypeError);
    await assert.rejects(pageDb.write([{ op: 'set', path: 'data/users/me/check', data: {} }]), /own reports/);
    await assert.rejects(pageDb.list('data/team/notes/n1'), /collection/);
    assert.equal(db.docs.size, 1);
  });

  it('refuses writes from a reader who can’t edit', async () => {
    const db = createMemoryDb();
    const pageDb = await pageDbWith(db, false).page;
    await assert.rejects(pageDb.add('data/team/notes', { text: 'x' }), /owner and editors/);
    const viewerDb = await pageDbWith(db, false, { id: 'guest-v', name: 'Vic', role: 'viewer' }).page;
    await assert.rejects(viewerDb.add('data/users/me/notes/items', { text: 'x' }), /owner and editors/);
    assert.equal(db.docs.size, 0);
  });

  it('lets a commenter write their own folder only', async () => {
    const db = createMemoryDb();
    const { page, wrote } = pageDbWith(db, false, { id: 'guest-c', name: 'Cam', role: 'commenter' });
    const pageDb = await page;
    assert.equal(await pageDb.add('data/users/me/notes/items', { text: 'mine' }), 'data/users/guest-c/notes/items/fresh');
    await pageDb.write([{ op: 'set', path: 'data/users/guest-c/todo', data: { done: false } }]);
    assert.deepEqual(wrote, [['data/users/guest-c/notes/items/fresh'], ['data/users/guest-c/todo']]);
    await assert.rejects(pageDb.add('data/team/notes', { text: 'x' }), /own folder/);
    await assert.rejects(pageDb.write([{ op: 'set', path: 'data/users/guest-d/todo', data: {} }]), /own folder/);
    // One write outside the folder refuses the whole batch.
    await assert.rejects(
      pageDb.write([
        { op: 'set', path: 'data/users/me/a', data: {} },
        { op: 'set', path: 'data/team/notes/b', data: {} },
      ]),
      /own folder/,
    );
    assert.deepEqual([...db.docs.keys()], ['data/users/guest-c/notes/items/fresh', 'data/users/guest-c/todo']);
  });

  it('passes on changes to saved rows only', async () => {
    const db = createMemoryDb();
    const pageDb = await pageDbWith(db).page;
    const heard: DbChangeEvent[] = [];
    pageDb.onChange((event) => heard.push(event));
    db.remote({ 'elements/e1': { x: 1 } });
    db.remote({ 'data/team/notes/n1': { text: 'x' }, 'dash/meta': { title: 'T' } });
    assert.deepEqual(heard, [{ changes: { 'data/team/notes/n1': { text: 'x' } }, author: 'agent' }]);
  });

  it('gives uploads only to those who can edit, and nothing it doesn’t know', async () => {
    const assets = { upload: async () => ({ id: 'a', url: '/_blob/a', bytes: 1, contentType: 'image/png' }) };
    const host = (canEdit: boolean): PageCapabilityHost => ({
      db: () => null,
      viewer: () => viewer,
      canEdit: () => canEdit,
      downloads: () => null,
      assets: () => assets as never,
      wrote: () => undefined,
    });
    assert.equal(await createPageCapabilities(host(true)).use('assets'), assets);
    assert.equal(await createPageCapabilities(host(false)).use('assets'), null);
    assert.equal(await createPageCapabilities(host(true)).use('mcp'), null);
    const user = (await createPageCapabilities(host(true)).use('user')) as { me(): Promise<Viewer> };
    assert.deepEqual(await user.me(), viewer);
  });
});

describe('around saved rows', () => {
  const dataset = (id: string, source: Record<string, unknown>): Dataset =>
    content({ [id]: { title: id, source } }).datasets.find((each) => each.id === id) as Dataset;

  it('groups saved rows under artifact storage', () => {
    const groups = groupSourcesByConnector([
      dataset('a', { kind: 'store', path: 'data/team/a' }),
      dataset('f', { kind: 'file', url: '/_blob/x', name: 'f.csv', format: 'csv' }),
    ]);
    assert.deepEqual(groups.stores.map((each) => each.id), ['a']);
    assert.deepEqual(groups.files.map((each) => each.id), ['f']);
  });

  it('fetches sources marked only under [hidden] after the rest', () => {
    const ids = ['a', 'b', 'c', 'd'].map((id) => dataset(id, { kind: 'store', path: `data/team/${id}` }));
    const ordered = applyFetchPriority(ids, ['d'], ['b'], ['a', 'd']);
    assert.deepEqual(ordered.map((each) => each.id), ['d', 'c', 'b', 'a']);
  });

  it('moves along the selection toolbar with the arrows, Home and End', () => {
    assert.equal(getToolbarKeyTarget('ArrowRight', 2, 3), 0);
    assert.equal(getToolbarKeyTarget('ArrowLeft', 0, 3), 2);
    assert.equal(getToolbarKeyTarget('ArrowDown', 0, 3), 1);
    assert.equal(getToolbarKeyTarget('Home', 2, 3), 0);
    assert.equal(getToolbarKeyTarget('End', 0, 3), 2);
    assert.equal(getToolbarKeyTarget('Enter', 0, 3), null);
    assert.equal(getToolbarKeyTarget('ArrowRight', -1, 3), null);
  });
});
