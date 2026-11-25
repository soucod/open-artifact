/**
 * Live sync of the dashboard: keeps `useDocument` in step with the store
 * (`session().db`) and offers the writes the page makes. Writes show at
 * once and settle when the store has them; a saved copy on this device is
 * shown while the store is out of reach. Leaving or hiding the page sends
 * what is waiting; the Shell is told the save state.
 */

import type { ChromeCommand, ChromeReport } from '@open-artifact/runtime';
import { localStorageCache, LiveWriteError, type LiveSnapshot, type SyncChangeEvent, type SyncTransport } from '@open-artifact/live-store';
import { toast } from '@open-artifact/ui';
import type { UnknownRecord } from '@open-artifact/data-core';
import { recordDocumentEdit } from '../platform/edit-count.ts';
import { session } from '../services/session.ts';
import { onShellCommand, setShellReport, useShellDraws } from '../services/shell.ts';
import { useDocument } from '../state/document.ts';
import type { DataDocuments } from './codec.ts';
import { leaveHolds, onLeaveHoldsChange } from './leave.ts';
import { createDataLiveDocument, createDocumentViewer, LIVE_SYNC_UNAVAILABLE, type DataLiveDocument, type WriteFileOptions } from './live-document.ts';

export { DELETE_FIELD } from '@open-artifact/data-core';
export { LiveWriteError } from '@open-artifact/live-store';
export type { DataDocuments } from './codec.ts';
export { createDataLiveCodec, dataCollections, ownCollection, refuseDataDocument } from './codec.ts';
export {
  createDataLiveDocument,
  createDocumentViewer,
  splitDocuments,
  READ_ONLY_REASON,
  LIVE_SYNC_UNAVAILABLE,
  type DataLiveDocument,
  type DataLiveDocumentOptions,
  type DocumentView,
  type WriteFileOptions,
} from './live-document.ts';
export { applyStorePatch, isDeleteField, stripDeleteFields } from './patch.ts';
export { holdLeaveLosesWork, leaveHolds } from './leave.ts';

let live: DataLiveDocument | null = null;
let stop: (() => void) | null = null;
const remoteListeners = new Set<(event: SyncChangeEvent) => void>();

/** The running live document, or `null` before {@link startLiveDocument}. */
export function liveDocument(): DataLiveDocument | null {
  return live;
}

function notStarted(): Promise<void> {
  const promise = Promise.reject(new LiveWriteError('unavailable', LIVE_SYNC_UNAVAILABLE));
  promise.catch(() => undefined);
  return promise;
}

/** Merges a patch into `datasets/<id>`, stamped as this viewer's edit (unless it only changes `certifiedAs`). */
export function writeDataset(id: string, patch: UnknownRecord): Promise<void> {
  return live?.writeDataset(id, patch) ?? notStarted();
}

/** Merges a patch into `dash/settings`. */
export function writeSettings(patch: UnknownRecord): Promise<void> {
  return live?.writeSettings(patch) ?? notStarted();
}

/** Stores a page file's text, stamped as this viewer's edit; with `ifMatch`, only while the file is unchanged. */
export function writeFile(name: string, text: string, options?: WriteFileOptions): Promise<void> {
  return live?.writeFile(name, text, options) ?? notStarted();
}

/** Merges a patch into a document, creating it when absent; `DELETE_FIELD` removes a field. */
export function mergeDocument(path: string, patch: UnknownRecord): Promise<void> {
  return live?.mergeDocument(path, patch) ?? notStarted();
}

/** Replaces a document. */
export function setDocument(path: string, value: UnknownRecord): Promise<void> {
  return live?.setDocument(path, value) ?? notStarted();
}

/** Deletes a document. */
export function deleteDocument(path: string): Promise<void> {
  return live?.deleteDocument(path) ?? notStarted();
}

/** Replaces, or with `null` deletes, one of this viewer's own documents (`data/users/<uid>/<name>`). */
export function writeOwnDocument(name: string, value: UnknownRecord | null): Promise<void> {
  return live?.writeOwnDocument(name, value) ?? notStarted();
}

/** Sends every waiting write now; resolves when nothing more can be sent. */
export function flushWrites(): Promise<void> {
  return live?.flush() ?? Promise.resolve();
}

/** Retries a failed load, parked writes and backed-off writes now (the save status's retry). */
export function retrySync(): void {
  live?.store.retry();
}

/** Listens to changes made by anyone else (the agent, another page), before they apply. */
export function onRemoteChange(listener: (event: SyncChangeEvent) => void): () => void {
  remoteListeners.add(listener);
  return () => void remoteListeners.delete(listener);
}

function shellSaved(snapshot: LiveSnapshot<DataDocuments>): ChromeReport['saved'] {
  switch (snapshot.status) {
    case 'ready':
      return 'saved';
    // Edits waiting out the write debounce: on their way, not failed.
    case 'dirty':
      return 'saving';
    case 'error':
      return snapshot.loadState === 'failed' && snapshot.pending === 0 ? undefined : 'unsaved';
    case 'saving':
      return 'saving';
    case 'offline':
    case 'cached':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
    default:
      return undefined;
  }
}

/** The key of this page's saved copy (one per viewer: it holds their own documents too). */
function savedCopyKey(viewerId: string): string {
  return `data-saved-copy:${typeof location === 'undefined' ? '' : location.pathname}:${viewerId}`;
}

/**
 * Starts live sync over the session's store and keeps `useDocument`
 * current. Resolves once sync is running (the document shows `connecting`
 * until the store answers); calling it again does nothing.
 */
export async function startLiveDocument(): Promise<void> {
  if (live !== null) return;
  const { db, viewer, canEdit } = session();
  const transport: SyncTransport = {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    listing: async (collection) => (db.listing ? db.listing(collection) : { documents: await db.list(collection) }),
    // Paths come from the live codec, which only writes well-formed document paths.
    write: (writes) => db.write(writes as Parameters<typeof db.write>[0]),
    onChange: (listener) =>
      db.onChange((event) => {
        for (const remote of [...remoteListeners]) remote(event);
        listener(event);
      }),
  };
  const doc = createDataLiveDocument({
    transport,
    viewerId: viewer.id,
    readOnly: !canEdit,
    cache: localStorageCache(savedCopyKey(viewer.id)),
    onEdit: () => recordDocumentEdit(),
  });
  live = doc;
  const view = createDocumentViewer(viewer.id, canEdit);
  const stops: (() => void)[] = [];
  let lastNotice: number | undefined;

  stops.push(onLeaveHoldsChange(() => setShellReport({ leaveLosesWork: doc.store.getSnapshot().pending > 0 || leaveHolds() > 0 })));
  const publish = (): void => {
    const snapshot = doc.store.getSnapshot();
    useDocument.setState(view(snapshot));
    if (snapshot.notice !== undefined && snapshot.notice.id !== lastNotice) {
      lastNotice = snapshot.notice.id;
      toast.add({ title: snapshot.notice.message });
    }
    const { content } = useDocument.getState();
    setShellReport({
      saved: shellSaved(snapshot),
      leaveLosesWork: snapshot.pending > 0 || leaveHolds() > 0,
      hasContent: content.files.length > 0 || content.datasets.length > 0,
    });
  };
  stops.push(doc.store.subscribe(publish));
  publish();

  stops.push(
    onShellCommand((command: ChromeCommand) => {
      if (command.cmd !== 'action' || command.id !== 'save_now') return;
      doc.store.retry();
      void doc.flush();
    }),
  );

  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (doc.store.getSnapshot().pending === 0 && leaveHolds() === 0) return;
    void doc.flush();
    // A Shell asks before closing on its own (it has `leaveLosesWork`).
    if (!useShellDraws.getState().framed) event.preventDefault();
  };
  const onHide = (): void => {
    if (document.visibilityState === 'hidden') void doc.flush();
  };
  const onPageHide = (): void => void doc.flush();
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onHide);
  stops.push(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onHide);
  });

  stop = () => {
    for (const fn of stops.reverse()) fn();
  };
}

/** Sends what is waiting and stops live sync. */
export async function stopLiveDocument(): Promise<void> {
  const doc = live;
  if (doc === null) return;
  stop?.();
  stop = null;
  live = null;
  await doc.flush();
  doc.dispose();
}
