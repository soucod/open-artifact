/**
 * The live engine against a store that keeps an order (`epoch` + `seq`, like
 * the type server's DbHost): events reach each page in order, but a write's
 * answer or a listing may arrive before or after events about older or newer
 * changes, and a dropped stream loses the events sent while it was down.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addInk, withInks } from '../src/inks.ts';
import { applyJsonMergePatch } from '../src/json.ts';
import type { BoardElement, HexColor, NoteElement } from '../src/schema.ts';
import { ACKNOWLEDGED_WRITE_GRACE_MS, LIVE_EDIT_DEBOUNCE_MS } from '../src/sync/engine.ts';
import { createLiveBoardDocument, type LiveBoardDocument } from '../src/sync/live-board.ts';
import {
  collectionOfPath,
  type SyncChangeEvent,
  type SyncDocument,
  type SyncListing,
  type SyncReceipt,
  type SyncTimers,
  type SyncTransport,
  type SyncWrite,
} from '../src/sync/transport.ts';

/* ------------------------------------------------------------------ fakes */

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

class FakeTimers implements SyncTimers {
  time = 1_000_000;
  private nextId = 1;
  private queue = new Map<number, { at: number; callback: () => void }>();
  setTimeout = (callback: () => void, ms: number): number => {
    const id = this.nextId++;
    this.queue.set(id, { at: this.time + Math.max(0, ms), callback });
    return id;
  };
  clearTimeout = (handle: unknown): void => void this.queue.delete(handle as number);
  now = (): number => this.time;
  random = (): number => 0;
  async advance(ms: number): Promise<void> {
    const target = this.time + ms;
    await settle();
    for (;;) {
      let soonest: [number, { at: number; callback: () => void }] | undefined;
      for (const item of this.queue) if (item[1].at <= target && (soonest === undefined || item[1].at < soonest[1].at)) soonest = item;
      if (soonest === undefined) break;
      this.queue.delete(soonest[0]);
      this.time = Math.max(this.time, soonest[1].at);
      soonest[1].callback();
      await settle();
    }
    this.time = target;
    await settle();
  }
}

type Docs = Record<string, Record<string, unknown>>;

/** One ordered store: a write applies at once, counts one `seq`, and goes to every other page's stream. */
class Store {
  epoch = 'epoch-1';
  seq = 0;
  docs = new Map<string, Record<string, unknown>>();
  pages: Page[] = [];

  constructor(docs: Docs) {
    for (const [path, data] of Object.entries(docs)) this.docs.set(path, structuredClone(data));
  }

  page(): Page {
    const page = new Page(this);
    this.pages.push(page);
    return page;
  }

  apply(writes: SyncWrite[], from: Page | undefined): SyncReceipt {
    const documents: Record<string, Record<string, unknown> | null> = {};
    for (const write of writes) {
      if (write.op === 'delete') this.docs.delete(write.path);
      else if (write.op === 'set') this.docs.set(write.path, structuredClone(write.data));
      else this.docs.set(write.path, applyJsonMergePatch(this.docs.get(write.path), write.patch));
      documents[write.path] = structuredClone(this.docs.get(write.path) ?? null);
    }
    this.seq += 1;
    for (const page of this.pages) if (page !== from) page.deliver({ changes: structuredClone(documents), epoch: this.epoch, seq: this.seq });
    return { epoch: this.epoch, seq: this.seq, documents };
  }

  /** The agent edits a file and the host has not reported it yet (no event). */
  quietly(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, structuredClone(data));
  }

  /** The host restarts: a new epoch, counting from zero; every stream starts again. */
  restart(): void {
    this.epoch = 'epoch-2';
    this.seq = 0;
    for (const page of this.pages) page.reconnect();
  }
}

/** One page's transport: its own event stream (FIFO, may be held or dropped) and HTTP calls (answers may be held). */
class Page implements SyncTransport {
  private readonly store: Store;
  private listeners = new Set<(event: SyncChangeEvent) => void>();
  queue: SyncChangeEvent[] = [];
  /** The stream is slow: events wait until {@link release}. */
  held = false;
  /** The stream is down: events are lost. */
  down = false;
  /** Write answers wait for this. */
  answerGate: Promise<void> | undefined;
  /** Listings (read at call time) are answered after this. */
  listGate: Promise<void> | undefined;
  listings = 0;

  constructor(store: Store) {
    this.store = store;
  }

  async get(path: string): Promise<Record<string, unknown> | null> {
    return structuredClone(this.store.docs.get(path) ?? null);
  }

  async listing(collection: string): Promise<SyncListing> {
    this.listings += 1;
    const documents: SyncDocument[] = [...this.store.docs]
      .filter(([path]) => collectionOfPath(path) === collection)
      .map(([path, data]) => ({ path, data: structuredClone(data) }));
    const read = { documents, epoch: this.store.epoch, seq: this.store.seq };
    if (this.listGate) await this.listGate;
    return read;
  }

  async list(collection: string): Promise<SyncDocument[]> {
    return (await this.listing(collection)).documents;
  }

  async write(writes: SyncWrite[]): Promise<SyncReceipt> {
    const receipt = this.store.apply(writes, this);
    if (this.answerGate) await this.answerGate;
    return receipt;
  }

  onChange(listener: (event: SyncChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  deliver(event: SyncChangeEvent): void {
    if (this.down) return;
    this.queue.push(event);
    this.pump();
  }

  pump(): void {
    if (this.held) return;
    while (this.queue.length > 0) {
      const event = this.queue.shift()!;
      for (const listener of [...this.listeners]) listener(event);
    }
  }

  release(): void {
    this.held = false;
    this.pump();
  }

  disconnect(): void {
    this.down = true;
    this.queue = [];
  }

  /** The stream starts again; the host's first event says where it stands. */
  reconnect(): void {
    this.down = false;
    this.deliver({ changes: {}, resync: true, epoch: this.store.epoch, seq: this.store.seq });
  }
}

/* ---------------------------------------------------------------- helpers */

const note = (id: string, text: string, x = 0): NoteElement => ({ type: 'note', id, x, y: 0, w: 180, h: 180, color: 'yellow', text, tilt: 0 });
const stored = ({ id: _id, ...rest }: NoteElement): Record<string, unknown> => rest;
const seed = (...notes: NoteElement[]): Docs => ({
  'board/meta': { v: 1, title: 'Board', order: notes.map((item) => item.id) },
  'board/inks': { colors: {} },
  ...Object.fromEntries(notes.map((item) => [`elements/${item.id}`, stored(item)])),
});
const noteOf = (doc: LiveBoardDocument, id: string): NoteElement | undefined => doc.content().elements.find((item) => item.id === id) as NoteElement | undefined;
const edit = (doc: LiveBoardDocument, id: string, change: Partial<NoteElement>): void => {
  doc.updateContent((content) => ({ ...content, elements: content.elements.map((item): BoardElement => (item.id === id ? { ...(item as NoteElement), ...change } : item)) }));
};

async function twoPages(docs: Docs): Promise<{ store: Store; timers: FakeTimers; pa: Page; pb: Page; a: LiveBoardDocument; b: LiveBoardDocument }> {
  const store = new Store(docs);
  const timers = new FakeTimers();
  const pa = store.page();
  const pb = store.page();
  const a = createLiveBoardDocument({ transport: pa, timers });
  const b = createLiveBoardDocument({ transport: pb, timers });
  await timers.advance(0);
  return { store, timers, pa, pb, a, b };
}

/* ------------------------------------------------------------------ tests */

describe('live sync with an ordered store', () => {
  it('keeps our write when an event about an older change arrives after its answer', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a')));
    pa.held = true; // A's stream lags behind its HTTP answers
    edit(b, 'n1', { x: 40 });
    await b.flush();
    edit(a, 'n1', { text: 'mine' });
    await a.flush();
    pa.release(); // B's older move reaches A
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS * 2);
    assert.deepEqual({ text: store.docs.get('elements/n1')?.text, x: store.docs.get('elements/n1')?.x }, { text: 'mine', x: 40 });
    assert.deepEqual({ text: noteOf(a, 'n1')?.text, x: noteOf(a, 'n1')?.x }, { text: 'mine', x: 40 }, 'A shows both edits, as the store does');
  });

  it('does not bring back a document we deleted when an older event arrives late', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a'), note('n2', 'b')));
    pa.held = true;
    edit(b, 'n1', { x: 40 });
    await b.flush();
    a.updateContent((content) => ({ ...content, elements: content.elements.filter((item) => item.id !== 'n1') }));
    await a.flush();
    pa.release();
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS * 2);
    assert.equal(store.docs.has('elements/n1'), false);
    assert.equal(noteOf(a, 'n1'), undefined);
    assert.ok(noteOf(a, 'n2'));
  });

  it('shows a newer change when our write is answered after its event', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a')));
    let answer!: () => void;
    pa.answerGate = new Promise((resolve) => (answer = resolve));
    edit(a, 'n1', { text: 'mine' });
    const flushed = a.flush();
    await timers.advance(0);
    edit(b, 'n1', { text: 'theirs' }); // stored after A's write; its event reaches A first
    await b.flush();
    answer();
    await flushed;
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS * 2);
    assert.equal(store.docs.get('elements/n1')?.text, 'theirs');
    assert.equal(noteOf(a, 'n1')?.text, 'theirs');
    assert.equal(noteOf(b, 'n1')?.text, 'theirs');
  });

  it('shows a newer change when a direct write is answered after its event', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a')));
    let answer!: () => void;
    pa.answerGate = new Promise((resolve) => (answer = resolve));
    const written = a.writeNow([{ op: 'set', path: 'elements/n1', data: stored(note('n1', 'mine')) }]);
    await timers.advance(0);
    edit(b, 'n1', { text: 'theirs' });
    await b.flush();
    answer();
    await written;
    await timers.advance(ACKNOWLEDGED_WRITE_GRACE_MS * 2);
    assert.equal(store.docs.get('elements/n1')?.text, 'theirs');
    assert.equal(noteOf(a, 'n1')?.text, 'theirs');
  });

  it('shows what the store merged our write into, a change it had not reported included', async () => {
    const { store, timers, a } = await twoPages(seed(note('n1', 'a')));
    store.quietly('elements/n1', { ...stored(note('n1', 'a')), color: 'blue' }); // the agent's edit, not reported yet
    edit(a, 'n1', { text: 'mine' });
    await a.flush();
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(noteOf(a, 'n1')?.color, 'blue');
    assert.equal(noteOf(a, 'n1')?.text, 'mine');
  });

  it('reads everything again after its stream reconnects, editing and writing all along', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a'), note('n2', 'b')));
    const before = pa.listings;
    pa.disconnect();
    edit(b, 'n1', { text: 'while you were away' }); // A never hears of it
    await b.flush();
    edit(a, 'n2', { text: 'mine' });
    await a.flush();
    assert.equal(store.docs.get('elements/n2')?.text, 'mine');
    assert.equal(noteOf(a, 'n1')?.text, 'a', 'the event was lost');
    pa.reconnect();
    assert.equal(a.getSnapshot().loadState, 'live');
    assert.ok(a.canEdit(), 'editing goes on while it reads again');
    edit(a, 'n2', { text: 'mine, again' });
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS * 2);
    assert.ok(pa.listings > before, 'it read the documents again');
    assert.equal(noteOf(a, 'n1')?.text, 'while you were away');
    assert.equal(noteOf(a, 'n2')?.text, 'mine, again');
    assert.equal(store.docs.get('elements/n2')?.text, 'mine, again');
    assert.notEqual(a.getSnapshot().status, 'loading');
  });

  it('does not read again when its stream started where it already stood', async () => {
    const { timers, pa, a } = await twoPages(seed(note('n1', 'a')));
    const before = pa.listings;
    pa.reconnect(); // nothing was missed: the listing already holds everything up to the stream's start
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(pa.listings, before);
    assert.equal(noteOf(a, 'n1')?.text, 'a');
  });

  it('keeps our write when a listing read before it is answered after it', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a'), note('n2', 'b')));
    pa.disconnect();
    edit(b, 'n2', { text: 'theirs' });
    await b.flush();
    let answer!: () => void;
    pa.listGate = new Promise((resolve) => (answer = resolve));
    pa.reconnect(); // A reads everything again; the listing is read now and answered later
    await timers.advance(0);
    edit(a, 'n1', { text: 'mine' });
    await a.flush();
    answer();
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS * 2);
    assert.equal(store.docs.get('elements/n1')?.text, 'mine');
    assert.equal(noteOf(a, 'n1')?.text, 'mine', 'the older listing does not undo the write');
    assert.equal(noteOf(a, 'n2')?.text, 'theirs');
  });

  it('starts over when the store restarts (a new epoch)', async () => {
    const { store, timers, pa, a, b } = await twoPages(seed(note('n1', 'a'), note('n2', 'b')));
    for (let i = 0; i < 5; i += 1) {
      edit(b, 'n2', { x: i + 1 }); // A's floors climb in the old epoch
      await b.flush();
      await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    }
    const before = pa.listings;
    store.restart();
    await timers.advance(0);
    edit(b, 'n1', { text: 'after the restart' }); // seq 1 of the new epoch, below A's old floors
    await b.flush();
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS * 2);
    assert.ok(pa.listings > before, 'it read the documents again');
    assert.equal(noteOf(a, 'n1')?.text, 'after the restart');
    assert.equal(noteOf(a, 'n2')?.x, 5);
  });

  it('loads through a Shell that does not know `listing` (one left open while the daemon was upgraded)', async () => {
    const store = new Store(seed(note('n1', 'a')));
    const timers = new FakeTimers();
    const page = store.page();
    let refused = 0;
    let listed = 0;
    // What the old broker answers for a method it does not broker.
    page.listing = async () => {
      refused += 1;
      throw Object.assign(new Error('unknown method db.listing'), { code: 'invalid' });
    };
    page.list = async (collection) => {
      listed += 1;
      return [...store.docs].filter(([path]) => collectionOfPath(path) === collection).map(([path, data]) => ({ path, data: structuredClone(data) }));
    };
    const doc = createLiveBoardDocument({ transport: page, timers });
    await timers.advance(0);
    assert.equal(doc.getSnapshot().status, 'ready');
    assert.equal(noteOf(doc, 'n1')?.text, 'a');
    const refusedOnce = refused;
    assert.ok(refusedOnce > 0 && listed > 0);
    page.reconnect(); // without an order, a restarted stream reads everything again: by `list` alone now
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS);
    assert.equal(refused, refusedOnce, '`listing` is not asked again');
  });

  it('does not fall back to `list` when `listing` fails for want of the store', async () => {
    const store = new Store(seed(note('n1', 'a')));
    const timers = new FakeTimers();
    const page = store.page();
    let listed = 0;
    page.listing = async () => {
      throw Object.assign(new Error('offline'), { code: 'unavailable' });
    };
    page.list = async () => {
      listed += 1;
      return [];
    };
    const doc = createLiveBoardDocument({ transport: page, timers });
    await timers.advance(0);
    assert.notEqual(doc.getSnapshot().status, 'live');
    assert.equal(listed, 0);
  });
});

describe('custom inks', () => {
  it('keeps the color just added by a device whose clock runs behind', async () => {
    const colors = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [i.toString(16).padStart(6, '0'), 1000 + i]));
    const { timers, a, b } = await twoPages({ ...seed(note('n1', 'a')), 'board/inks': { colors } });
    assert.equal(a.content().inks?.length, 64);
    a.setContent(withInks(a.content(), addInk(a.content().inks ?? [], '#aaaaaa', 500))); // A's clock is behind
    await a.flush();
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS * 2);
    b.setContent(withInks(b.content(), addInk(b.content().inks ?? [], '#bbbbbb', 6000)));
    await b.flush();
    await timers.advance(LIVE_EDIT_DEBOUNCE_MS * 2);
    for (const doc of [a, b]) {
      const held = (doc.content().inks ?? []).map((ink) => ink.color);
      assert.ok(held.includes('#aaaaaa' as HexColor), 'the color added before the newest stays');
      assert.ok(held.includes('#bbbbbb' as HexColor));
      assert.ok(!held.includes('#000000' as HexColor), 'the oldest goes');
    }
  });
});
