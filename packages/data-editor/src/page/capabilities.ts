/**
 * What a page script reaches through `openartifact.use(name)`: the artifact's store, narrowed to saved rows under
 * `data/` (with `data/users/me` read as the viewer's own folder; a commenter writes only there), who is looking, file
 * downloads, and uploads for those who can edit; in the embedded view, only the store (read) and who is looking. It is a convenience for the
 * author's own code, not a boundary: the page runs in the same window as the host runtime.
 */

import type {
  AssetsCapability,
  DbCapability,
  DbChangeEvent,
  DbDocument,
  DbWrite,
  DownloadsCapability,
  JsonRecord,
  Viewer,
} from '@open-artifact/runtime';
import { getSavedRowsShape, isInViewerFolder, resolveSavedRowsPath, savedRowsPathProblem, type SavedRowsShape } from '@open-artifact/data-core';
import { saveFile } from '@open-artifact/editor-kit';
import { INLINE_READ_ONLY_MESSAGE, isInlineView } from '../platform/inline-view.ts';
import { maybeSession } from '../services/session.ts';

/** The names `openartifact.use` gives a page script. */
export const PAGE_CAPABILITY_NAMES = ['db', 'user', 'downloads', 'assets'] as const;
export type PageCapabilityName = (typeof PAGE_CAPABILITY_NAMES)[number];

/** The store as a page script sees it. */
export interface PageDb {
  /** One saved document; `null` when it doesn't exist. */
  get(path: string): Promise<JsonRecord | null>;
  /** A collection's documents, sorted by path. */
  list(collection: string): Promise<DbDocument[]>;
  /** A batch of writes (set, update, delete), all or nothing. */
  write(writes: readonly DbWrite[]): Promise<void>;
  /** Adds a document with a new ID to a collection; resolves to its path. */
  add(collection: string, data: JsonRecord): Promise<string>;
  /** Hears saved rows changed by anyone else. */
  onChange(listener: (event: DbChangeEvent) => void): () => void;
}

export interface PageCapabilityHost {
  db(): DbCapability | null;
  viewer(): Viewer | null;
  canEdit(): boolean;
  downloads(): DownloadsCapability | null;
  assets(): AssetsCapability | null;
  /** The page wrote these documents (the store doesn't tell a writer about its own writes). */
  wrote(documents: readonly string[]): Promise<void> | void;
  /** A new document ID. */
  newId?: () => string;
}

/** `openartifact` inside a page script. */
export interface PageCapabilities {
  use(name: unknown): Promise<PageDb | { me(): Promise<Viewer> } | DownloadsCapability | AssetsCapability | null>;
}

const PATH_PROBLEM_WORDS = {
  not_text: 'a path is text',
  outside_data: 'saved rows live under data/',
  bad_segment: 'each part is 1–200 of A–Z a–z 0–9 _ - . ~ : @ + (and not . or ..)',
  too_deep: 'a path has at most 16 parts',
  own_report: 'that folder holds the page’s own reports',
} as const;

const SHAPE_WORDS: Record<SavedRowsShape, string> = {
  collection: 'a collection (an odd number of parts)',
  document: 'one document (an even number of parts)',
};

const NOT_WRITER_MESSAGE = 'Only the owner and editors can save rows here.';
const COMMENTER_FOLDER_MESSAGE = 'A commenter saves rows only in their own folder, data/users/me/….';

function defaultId(): string {
  return globalThis.crypto.randomUUID().replaceAll('-', '');
}

/** A path made ready for the store, or a TypeError saying why it can't be used. */
function storePath(path: unknown, shape: SavedRowsShape, viewer: Viewer | null): string {
  const problem = savedRowsPathProblem(path);
  if (problem !== null) throw new TypeError(`${JSON.stringify(path)}: ${PATH_PROBLEM_WORDS[problem]}.`);
  const text = path as string;
  if (getSavedRowsShape(text) !== shape) throw new TypeError(`${JSON.stringify(path)} isn’t ${SHAPE_WORDS[shape]}.`);
  return viewer === null || viewer.id === '' ? text : resolveSavedRowsPath(text, viewer.id);
}

const isSavedPath = (path: string): boolean => savedRowsPathProblem(path) === null;

function pageDb(host: PageCapabilityHost, store: DbCapability): PageDb {
  const checkedWrite = async (writes: readonly DbWrite[]): Promise<void> => {
    if (!Array.isArray(writes) || writes.length === 0) throw new TypeError('write takes a list of writes.');
    const viewer = host.viewer();
    const ready = writes.map((write): DbWrite => ({ ...write, path: storePath(write.path, 'document', viewer) }));
    if (!host.canEdit()) {
      if (viewer?.role !== 'commenter') throw new Error(NOT_WRITER_MESSAGE);
      if (!ready.every((write) => isInViewerFolder(write.path, viewer.id))) throw new Error(COMMENTER_FOLDER_MESSAGE);
    }
    await store.write(ready);
    await host.wrote(ready.map((write) => write.path));
  };
  return {
    get: async (path) => store.get(storePath(path, 'document', host.viewer())),
    list: async (collection) => {
      const path = storePath(collection, 'collection', host.viewer());
      const listed = await store.list(path);
      return listed.filter((document) => document.path.slice(0, document.path.lastIndexOf('/')) === path);
    },
    write: checkedWrite,
    async add(collection, data) {
      const path = `${storePath(collection, 'collection', host.viewer())}/${(host.newId ?? defaultId)()}`;
      await checkedWrite([{ op: 'set', path, data, ifMatch: null }]);
      return path;
    },
    onChange(listener) {
      if (typeof listener !== 'function') throw new TypeError('onChange takes a function.');
      return store.onChange((event) => {
        const changes = Object.fromEntries(Object.entries(event.changes).filter(([path]) => isSavedPath(path)));
        if (Object.keys(changes).length === 0) return;
        listener({ changes, ...(event.author === undefined ? {} : { author: event.author }) });
      });
    },
  };
}

export function createPageCapabilities(host: PageCapabilityHost): PageCapabilities {
  return {
    async use(name) {
      switch (name) {
        case 'db': {
          const store = host.db();
          return store === null ? null : pageDb(host, store);
        }
        case 'user': {
          return {
            me: async () => {
              const viewer = host.viewer();
              if (viewer === null) throw new Error('No one is signed in to this view.');
              return { ...viewer };
            },
          };
        }
        case 'downloads': {
          const downloads = host.downloads();
          return {
            save: async (file: { name: string; data: Blob }) => {
              const saved = await saveFile(downloads, file.name, file.data);
              return saved.to === 'host' && saved.savedTo !== undefined ? { savedTo: saved.savedTo } : {};
            },
          };
        }
        case 'assets':
          return host.canEdit() ? host.assets() : null;
        default:
          return null;
      }
    },
  };
}

/** The page's capabilities from the session it runs in; `wrote` hears the page's own writes. */
export function sessionPageCapabilities(wrote: PageCapabilityHost['wrote']): PageCapabilities {
  const capabilities = createPageCapabilities({
    db: () => maybeSession()?.db ?? null,
    viewer: () => maybeSession()?.viewer ?? null,
    canEdit: () => maybeSession()?.canEdit === true,
    downloads: () => maybeSession()?.downloads ?? null,
    assets: () => maybeSession()?.assets ?? null,
    wrote,
  });
  return isInlineView() ? embeddedPageCapabilities(capabilities) : capabilities;
}

/** The names a page script reaches in the embedded view. */
export const EMBEDDED_PAGE_CAPABILITY_NAMES: readonly PageCapabilityName[] = ['db', 'user'];

/**
 * What a page script reaches in the embedded view: the store to read and `user`, nothing else. Saving is refused
 * with the reason, before any path is looked at.
 */
export function embeddedPageCapabilities(full: PageCapabilities): PageCapabilities {
  const refuse = (): Promise<never> => Promise.reject(new Error(INLINE_READ_ONLY_MESSAGE));
  return {
    async use(name) {
      if (!EMBEDDED_PAGE_CAPABILITY_NAMES.includes(name as PageCapabilityName)) return null;
      const given = await full.use(name);
      if (name !== 'db' || given === null) return given;
      return { ...(given as PageDb), write: refuse, add: refuse };
    },
  };
}
