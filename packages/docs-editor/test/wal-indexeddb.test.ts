/**
 * The write-ahead log kept in IndexedDB, on a small stand-in for it: what a closed page left of a tab is claimed by the
 * next page that opens the tab, and sent again. The stand-in keeps IndexedDB's one-handler-per-request `onsuccess` and
 * runs a transaction's requests in later tasks, so a store whose claim only reads and never moves fails here.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { TabWal, type WalEntry, indexedDbWalStore } from '../src/sync/wal.ts';

type Key = unknown[];
type Handler = (() => void) | null;

/** One request: its `onsuccess`/`onerror` are plain properties, as in IndexedDB (setting one replaces the other). */
class FakeRequest<T = unknown> {
  result!: T;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

const same = (a: Key, b: Key) => JSON.stringify(a) === JSON.stringify(b);

class FakeDb {
  readonly stores = new Map<string, { keyPath: string[]; rows: Map<string, Record<string, unknown>> }>();
  onversionchange: Handler = null;
  objectStoreNames = { contains: (name: string) => this.stores.has(name) };
  createObjectStore(name: string, options: { keyPath: string[] }) {
    this.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
  }
  transaction() {
    return new FakeTx(this);
  }
  close() {}
}

/** A transaction: each request answers in a task of its own; it completes once none is left. */
class FakeTx {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: Error | null = null;
  private open = 0;
  private finished = false;
  private readonly db: FakeDb;
  constructor(db: FakeDb) {
    this.db = db;
    // A transaction asked for nothing still completes.
    setTimeout(() => this.settle(), 0);
  }
  objectStore(name: string) {
    const table = this.db.stores.get(name)!;
    const keyOf = (row: Record<string, unknown>) => JSON.stringify(table.keyPath.map(k => row[k]));
    const run = <T>(work: () => T) => {
      assert.equal(this.finished, false, 'a request on a finished transaction');
      const request = new FakeRequest<T>();
      this.open++;
      setTimeout(() => {
        request.result = work();
        request.onsuccess?.();
        this.open--;
        this.settle();
      }, 0);
      return request;
    };
    return {
      name,
      put: (row: Record<string, unknown>) => run(() => void table.rows.set(keyOf(row), structuredClone(row))),
      delete: (key: Key) => run(() => void table.rows.delete(JSON.stringify(key))),
      getAll: (range?: { lower: Key; upper: Key }) =>
        run(() =>
          [...table.rows.values()]
            .filter(row => !range || same(table.keyPath.slice(0, range.lower.length).map(k => row[k]), range.lower))
            .map(row => structuredClone(row)),
        ),
    };
  }
  private settle() {
    if (this.finished || this.open > 0) return;
    this.finished = true;
    this.oncomplete?.();
  }
}

const databases = new Map<string, FakeDb>();
const fakeIndexedDb = {
  open(name: string) {
    const request = new FakeRequest<FakeDb>();
    setTimeout(() => {
      let db = databases.get(name);
      if (!db) {
        db = new FakeDb();
        databases.set(name, db);
        request.result = db;
        request.onupgradeneeded?.();
      }
      request.result = db;
      request.onsuccess?.();
    }, 0);
    return request;
  },
};

const rowsOf = (name: string) => [...(databases.get(name)?.stores.get('ops')?.rows.values() ?? [])] as unknown as WalEntry[];

describe('the write-ahead log in IndexedDB', () => {
  const saved: Record<string, unknown> = {};
  before(() => {
    for (const key of ['indexedDB', 'IDBKeyRange']) saved[key] = (globalThis as Record<string, unknown>)[key];
    Object.assign(globalThis, { indexedDB: fakeIndexedDb, IDBKeyRange: { bound: (lower: Key, upper: Key) => ({ lower, upper }) } });
  });
  after(() => Object.assign(globalThis, saved));

  it('a page that opens the tab claims what a closed page left, and holds it under its own life', async () => {
    const name = 'wal-claim-test';
    const store = indexedDbWalStore(name);
    const closed = new TabWal({ store, doc: 'doc-1', tab: 'tab-1', life: 'old~1' });
    closed.append([{ op: 'insert', text: 'Held' }]);
    closed.append([{ op: 'insert', text: ' words' }]);
    // Another tab's entry is not this page's to take.
    new TabWal({ store, doc: 'doc-1', tab: 'tab-2', life: 'old~1' }).append([{ op: 'insert', text: 'other tab' }]);
    await closed.flushed(2000);
    assert.equal(rowsOf(name).length, 3, 'kept before the page went away');

    const next = new TabWal({ store, doc: 'doc-1', tab: 'tab-1', life: 'new~2' });
    const taken = await next.recover();
    assert.deepEqual(taken.map(e => e.ops[0]!.text), ['Held', ' words'], 'what the closed page left, in its order');
    assert.ok(taken.every(e => e.life === 'new~2' && e.seq < 0 && typeof e.opId === 'string'), JSON.stringify(taken));
    const rows = rowsOf(name);
    assert.deepEqual(rows.filter(e => e.tab === 'tab-1').map(e => e.life), ['new~2', 'new~2'], 'moved under the new life');
    assert.deepEqual(rows.filter(e => e.tab === 'tab-2').map(e => e.life), ['old~1'], 'the other tab is left alone');

    // Once they land, they are let go: a later page finds nothing more to send.
    next.done(taken.map(e => e.seq));
    await next.flushed(2000);
    assert.deepEqual(await new TabWal({ store, doc: 'doc-1', tab: 'tab-1', life: 'later~3' }).recover(), []);
  });
});
