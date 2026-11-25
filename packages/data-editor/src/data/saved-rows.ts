/**
 * Reads saved rows (`{kind: "store", path}` sources) from the artifact's store and keeps them current: each path is
 * listed (a collection) or read (a document) once it is asked for, and every change someone else makes under it is
 * laid over what was read, so the source's rows follow without reading the store again.
 */

import type { DbCapability, DbChangeEvent, JsonRecord } from '@open-artifact/runtime';
import {
  SAVED_ROWS_FIRST_ANSWER_MS,
  SYSTEM_CLOCK,
  getSavedRowsShape,
  savedRowsTable,
  type LoadResult,
  type PollClock,
  type SavedRowsShape,
  type Table,
} from '@open-artifact/data-core';

export interface SavedRowsReader {
  /** Reads `path` from the store (again), keeping what changed while the read was out. */
  load(path: string): Promise<LoadResult>;
  /** The rows last read for `path`, with every change since; `null` before the first answer. */
  current(path: string): Table | null;
  /** Reads these documents again after the page itself wrote them (the store doesn't echo a writer's own batch). */
  reread(documents: readonly string[]): Promise<void>;
  /** Hears each watched path whose rows changed. */
  subscribe(listener: (path: string) => void): () => void;
  dispose(): void;
}

export interface SavedRowsOptions {
  db: () => DbCapability | null;
  /** The clock a read's time is measured on. */
  clock?: PollClock;
  /** How long the first answer may take. */
  timeoutMs?: number;
}

interface Watched {
  shape: SavedRowsShape;
  documents: Map<string, JsonRecord>;
  answered: boolean;
  /** Document IDs changed while a read was out: the read's older copy of them is dropped. */
  movedDuringRead: Set<string> | null;
}

const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/'));
const idOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

const NO_STORE: LoadResult = {
  ok: false,
  kind: 'failed',
  message: 'This view has no store, so saved rows can’t be read here.',
  wording: { code: 'savedRowsUnavailable' },
};
const STORE_SILENT: LoadResult = {
  ok: false,
  kind: 'failed',
  message: 'The store didn’t answer in time.',
  wording: { code: 'savedRowsSilent' },
  timedOut: true,
};
const STORE_FAILED: LoadResult = {
  ok: false,
  kind: 'failed',
  message: 'Couldn’t read the saved rows.',
  wording: { code: 'savedRowsFailed' },
};

/** Whether a changed document belongs to the rows `path` gives. */
function touches(path: string, watched: Watched, document: string): boolean {
  return watched.shape === 'document' ? document === path : parentOf(document) === path;
}

export function createSavedRowsReader({ db, clock = SYSTEM_CLOCK, timeoutMs = SAVED_ROWS_FIRST_ANSWER_MS }: SavedRowsOptions): SavedRowsReader {
  const watched = new Map<string, Watched>();
  const listeners = new Set<(path: string) => void>();
  let unsubscribe: (() => void) | null = null;
  let disposed = false;

  const announce = (path: string): void => {
    for (const listener of [...listeners]) listener(path);
  };

  const apply = (changes: Record<string, JsonRecord | null>): void => {
    for (const [path, entry] of watched) {
      let moved = false;
      for (const [document, data] of Object.entries(changes)) {
        if (!touches(path, entry, document)) continue;
        const id = idOf(document);
        if (data === null) entry.documents.delete(id);
        else entry.documents.set(id, data);
        entry.movedDuringRead?.add(id);
        moved = true;
      }
      if (moved && entry.answered) announce(path);
    }
  };

  const listen = (store: DbCapability): void => {
    if (unsubscribe !== null) return;
    unsubscribe = store.onChange((event: DbChangeEvent) => {
      if (!disposed) apply(event.changes);
    });
  };

  const read = async (store: DbCapability, path: string, shape: SavedRowsShape): Promise<Map<string, JsonRecord>> => {
    if (shape === 'document') {
      const data = await store.get(path);
      return new Map(data === null ? [] : [[idOf(path), data]]);
    }
    const listed = await store.list(path);
    return new Map(listed.filter((document) => parentOf(document.path) === path).map((document) => [idOf(document.path), document.data]));
  };

  const withinTime = <T>(work: Promise<T>): Promise<T | 'late'> =>
    new Promise<T | 'late'>((resolve, reject) => {
      const timer = setTimeout(() => resolve('late'), timeoutMs);
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });

  const tableOf = (entry: Watched): Table =>
    savedRowsTable([...entry.documents].map(([id, data]) => ({ id, data })));

  return {
    async load(path) {
      const store = db();
      if (store === null) return NO_STORE;
      listen(store);
      const shape = getSavedRowsShape(path);
      let entry = watched.get(path);
      if (entry === undefined) {
        entry = { shape, documents: new Map(), answered: false, movedDuringRead: null };
        watched.set(path, entry);
      }
      const moved = new Set<string>();
      entry.movedDuringRead = moved;
      const startedAt = clock.now();
      let answer: Map<string, JsonRecord> | 'late';
      try {
        answer = await withinTime(read(store, path, shape));
      } catch {
        return STORE_FAILED;
      } finally {
        if (entry.movedDuringRead === moved) entry.movedDuringRead = null;
      }
      if (answer === 'late') return STORE_SILENT;
      for (const id of moved) {
        const live = entry.documents.get(id);
        if (live === undefined) answer.delete(id);
        else answer.set(id, live);
      }
      entry.documents = answer;
      entry.answered = true;
      return { ok: true, table: tableOf(entry), ms: Math.round(clock.now() - startedAt) };
    },
    current(path) {
      const entry = watched.get(path);
      return entry === undefined || !entry.answered ? null : tableOf(entry);
    },
    async reread(documents) {
      const store = db();
      if (store === null || documents.length === 0) return;
      const changes: Record<string, JsonRecord | null> = {};
      await Promise.all(
        [...new Set(documents)].map(async (document) => {
          const data = await store.get(document).then(
            (found) => ({ found }),
            () => null,
          );
          if (data !== null) changes[document] = data.found;
        }),
      );
      if (!disposed) apply(changes);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      unsubscribe?.();
      unsubscribe = null;
      listeners.clear();
    },
  };
}
