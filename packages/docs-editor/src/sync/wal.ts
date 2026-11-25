/**
 * The write-ahead log of a tab's edits: every group of ops the page makes is kept in IndexedDB (`oa-docs.op-wal`) from
 * before it goes out until the server has it, so edits made while the server can't be reached outlive the page.
 *
 * Entries are keyed by doc, tab, the page life that wrote them, and their order in that life. A page opening a tab
 * claims what earlier lives of the same doc and tab left behind (moving it under its own life in one step, so two pages
 * opening at once don't both send it) and sends it again. An entry that already went out keeps the `opId` of the call
 * that carried it: sent again under that `opId`, the server answers it once instead of landing it twice.
 *
 * A page that is still open holds a lock on its life (Web Locks), so another page of the same doc never takes edits
 * that page is still sending. Without IndexedDB nothing is kept and the page works as it would without the log.
 */
import { getDocs } from '../app/store.ts';
import { committed, openStore } from './idb.ts';

type Json = Record<string, unknown>;

export const WAL_DB = 'oa-docs.op-wal';
const WAL_STORE = 'ops';
const LOCK_PREFIX = `${WAL_DB}:`;

/** Edits older than this are let go instead of sent again. */
export const WAL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface WalEntry {
  doc: string;
  tab: string;
  /** The page life that wrote it (or claimed it). */
  life: string;
  /** Its order in that life; claimed entries come first, at negative places. */
  seq: number;
  ops: Json[];
  /** The call that carried it, once one went out (or the call it goes out in, for a claimed entry). */
  opId?: string;
  /** A call carrying it went out: it may have landed already. */
  sent?: boolean;
  /** When it was written, in ms since the epoch. */
  at: number;
}

export type WalKey = [doc: string, tab: string, life: string, seq: number];

export const walKey = (entry: Pick<WalEntry, 'doc' | 'tab' | 'life' | 'seq'>): WalKey => [entry.doc, entry.tab, entry.life, entry.seq];

/** Where entries are kept. */
export interface WalStore {
  put(entries: WalEntry[]): Promise<void>;
  remove(keys: WalKey[]): Promise<void>;
  /** In one step: moves what lives other than `life` (and not `alive`) left for `doc`/`tab` under `life`, as {@link claimPlan} says. */
  claim(doc: string, tab: string, life: string, alive: ReadonlySet<string>, now: number): Promise<WalEntry[]>;
}

/** Which page lives are still open. */
export interface Lives {
  /** Marks `life` open until the answer is called. */
  hold(life: string): () => void;
  alive(): Promise<Set<string>>;
}

/**
 * What a page claims of the entries kept for its doc and tab: those of other lives that are not open, younger than
 * {@link WAL_MAX_AGE_MS}, in the order they were written, under `life` at places -n … -1. An entry that never went
 * out is given a call of its own (consecutive ones of one life share it), named after where it was kept, so it is the
 * same `opId` whoever sends it. `drop` is every key taken (claimed or too old).
 */
export function claimPlan(entries: readonly WalEntry[], life: string, alive: ReadonlySet<string>, now: number): { take: WalEntry[]; drop: WalKey[] } {
  const theirs = entries.filter(entry => entry.life !== life && !alive.has(entry.life));
  const drop = theirs.map(walKey);
  const fresh = theirs.filter(entry => now - entry.at <= WAL_MAX_AGE_MS && Array.isArray(entry.ops) && entry.ops.length > 0);
  // Each life's entries stay together and in their order (a call's entries are next to each other); lives go oldest first.
  const started = new Map<string, number>();
  for (const entry of fresh) started.set(entry.life, Math.min(started.get(entry.life) ?? Infinity, entry.at));
  fresh.sort((a, b) => started.get(a.life)! - started.get(b.life)! || (a.life < b.life ? -1 : a.life > b.life ? 1 : 0) || a.seq - b.seq);
  const take: WalEntry[] = [];
  let run: { life: string; opId: string } | null = null;
  fresh.forEach((entry, index) => {
    // An entry keeps the call it went out in (or was given by an earlier claim).
    let opId = entry.opId;
    if (opId) run = null;
    else {
      if (!run || run.life !== entry.life) run = { life: entry.life, opId: `${entry.life}.wal${entry.seq}` };
      opId = run.opId;
    }
    take.push({ doc: entry.doc, tab: entry.tab, life, seq: index - fresh.length, ops: entry.ops, opId, ...(entry.sent ? { sent: true } : {}), at: entry.at });
  });
  return { take, drop };
}

/** One page life's log of one tab. Every write is queued in order; a failing store is ignored (the edit still goes out). */
export class TabWal {
  readonly doc: string;
  readonly tab: string;
  readonly life: string;
  private readonly store: WalStore;
  private readonly lives: Lives | null;
  private readonly entries = new Map<number, WalEntry>();
  private seq = 0;
  private chain: Promise<void> = Promise.resolve();
  private release: (() => void) | null;
  private readonly now: () => number;

  constructor(options: { store: WalStore; doc: string; tab: string; life: string; lives?: Lives | null; now?: () => number }) {
    this.store = options.store;
    this.doc = options.doc;
    this.tab = options.tab;
    this.life = options.life;
    this.lives = options.lives ?? null;
    this.now = options.now ?? Date.now;
    this.release = this.lives ? safely(() => this.lives!.hold(this.life), null) : null;
  }

  /** Keeps a group of ops; answers its place. */
  append(ops: Json[]): number {
    const entry: WalEntry = { doc: this.doc, tab: this.tab, life: this.life, seq: ++this.seq, ops, at: this.now() };
    this.entries.set(entry.seq, entry);
    this.queue(() => this.store.put([entry]));
    return entry.seq;
  }

  /** These groups go out in the call `opId`. */
  sent(seqs: readonly number[], opId: string): void {
    const changed: WalEntry[] = [];
    for (const seq of seqs) {
      const entry = this.entries.get(seq);
      if (!entry || (entry.sent && entry.opId === opId)) continue;
      entry.opId = opId;
      entry.sent = true;
      changed.push({ ...entry });
    }
    if (changed.length) this.queue(() => this.store.put(changed));
  }

  /** These groups landed, or never will: they are let go. */
  done(seqs: readonly number[]): void {
    const keys: WalKey[] = [];
    for (const seq of seqs) {
      if (!this.entries.delete(seq)) continue;
      keys.push([this.doc, this.tab, this.life, seq]);
    }
    if (keys.length) this.queue(() => this.store.remove(keys));
  }

  /** Takes over what earlier lives left of this tab, oldest first. */
  async recover(): Promise<WalEntry[]> {
    try {
      const alive = this.lives ? await this.lives.alive().catch(() => new Set<string>()) : new Set<string>();
      alive.delete(this.life);
      let taken: WalEntry[] = [];
      await this.queue(async () => {
        taken = await this.store.claim(this.doc, this.tab, this.life, alive, this.now());
      });
      for (const entry of taken) this.entries.set(entry.seq, entry);
      return taken;
    } catch {
      return [];
    }
  }

  /** Resolves once every write asked for so far is kept (or `waitMs` passed). */
  flushed(waitMs: number): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, waitMs);
      void this.chain.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** The page closes this tab: another page may take what is left. */
  close(): void {
    const release = this.release;
    this.release = null;
    if (release) safely(release, undefined);
  }

  private queue(work: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(work).catch(() => undefined);
    return this.chain;
  }
}

function safely<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch {
    return fallback;
  }
}

// ---- stores --------------------------------------------------------------------------------------------------------

/** Entries kept in memory (tests, and a page without IndexedDB that still wants the bookkeeping). */
export function memoryWalStore(): WalStore & { all(): WalEntry[] } {
  const kept = new Map<string, WalEntry>();
  const id = (key: WalKey) => JSON.stringify(key);
  const copy = (entry: WalEntry): WalEntry => ({ ...entry, ops: entry.ops });
  return {
    async put(entries) {
      for (const entry of entries) kept.set(id(walKey(entry)), copy(entry));
    },
    async remove(keys) {
      for (const key of keys) kept.delete(id(key));
    },
    async claim(doc, tab, life, alive, now) {
      const mine = [...kept.values()].filter(entry => entry.doc === doc && entry.tab === tab);
      const { take, drop } = claimPlan(mine, life, alive, now);
      for (const key of drop) kept.delete(id(key));
      for (const entry of take) kept.set(id(walKey(entry)), copy(entry));
      return take.map(copy);
    },
    all: () => [...kept.values()].map(copy),
  };
}

/** Entries kept in IndexedDB; with none, nothing is kept and nothing is claimed. */
export function indexedDbWalStore(name = WAL_DB): WalStore {
  const db = () => openStore(name, WAL_STORE, ['doc', 'tab', 'life', 'seq']);
  return {
    async put(entries) {
      const open = await db();
      if (!open) return;
      const tx = open.transaction(WAL_STORE, 'readwrite');
      const store = tx.objectStore(WAL_STORE);
      for (const entry of entries) store.put(entry);
      await committed(tx);
    },
    async remove(keys) {
      const open = await db();
      if (!open) return;
      const tx = open.transaction(WAL_STORE, 'readwrite');
      const store = tx.objectStore(WAL_STORE);
      for (const key of keys) store.delete(key);
      await committed(tx);
    },
    async claim(doc, tab, life, alive, now) {
      const open = await db();
      if (!open) return [];
      const tx = open.transaction(WAL_STORE, 'readwrite');
      const done = committed(tx);
      const store = tx.objectStore(WAL_STORE);
      const range = IDBKeyRange.bound([doc, tab], [doc, tab, []]);
      let take: WalEntry[] = [];
      const read = store.getAll(range);
      // The moves are asked for in the read's own callback, so the read and the moves are one transaction. (Not
      // `settle(read)`: it sets the read's onsuccess too, and the moves would never be asked for.)
      await new Promise<void>((resolve, reject) => {
        read.onsuccess = () => {
          const plan = claimPlan(read.result as WalEntry[], life, alive, now);
          take = plan.take;
          for (const key of plan.drop) store.delete(key);
          for (const entry of take) store.put(entry);
          resolve();
        };
        read.onerror = () => reject(read.error ?? new Error('IndexedDB request failed'));
      }).catch(() => undefined);
      await done;
      return take;
    },
  };
}

/** Page lives as Web Locks: an open page holds its life's lock until it closes the tab. */
export function webLockLives(): Lives | null {
  const locks = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks || typeof locks.request !== 'function' || typeof locks.query !== 'function') return null;
  return {
    hold(life) {
      let release: () => void = () => undefined;
      const held = new Promise<void>(resolve => {
        release = resolve;
      });
      void locks.request(`${LOCK_PREFIX}${life}`, () => held).catch(() => undefined);
      return release;
    },
    async alive() {
      const snapshot = await locks.query();
      const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map(lock => lock.name ?? '');
      return new Set(names.filter(name => name.startsWith(LOCK_PREFIX)).map(name => name.slice(LOCK_PREFIX.length)));
    },
  };
}

/** The doc the page has open, as the log names it. */
export function currentDocKey(): string {
  try {
    const id = getDocs().project?.id;
    if (id) return id;
  } catch {
    // No store yet: the page's address names the doc.
  }
  return typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'doc';
}

/** A new page life's name, under the writing session it starts with. */
export function newLife(sess: string): string {
  return `${sess}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The page's log of one tab, or `null` without IndexedDB. */
export function browserTabWal(tab: string, sess: string, doc = currentDocKey()): TabWal | null {
  try {
    if (typeof indexedDB === 'undefined' || !indexedDB) return null;
  } catch {
    return null;
  }
  return new TabWal({ store: indexedDbWalStore(), doc, tab, life: newLife(sess), lives: webLockLives() });
}
