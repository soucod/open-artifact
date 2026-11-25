/**
 * The Shell's save badge for the board's document store: `saving` while edits wait out the write debounce or are
 * being written, `unsaved` only when a save failed.
 */

import type { ChromeReport } from '@open-artifact/runtime';
import type { LiveSnapshot } from '@open-artifact/whiteboard-core';

/** The Shell's save badge for an engine status (`undefined` while loading). */
export function shellSaved(snapshot: Pick<LiveSnapshot<unknown>, 'status' | 'loadState' | 'pending'>): ChromeReport['saved'] {
  switch (snapshot.status) {
    case 'ready':
      return 'saved';
    // Edits waiting out the write debounce: on their way, not failed.
    case 'dirty':
    case 'saving':
      return 'saving';
    // A board that could not load, with no edits of ours waiting, has nothing unsaved: the page says why.
    case 'error':
      return snapshot.loadState === 'failed' && snapshot.pending === 0 ? undefined : 'unsaved';
    case 'offline':
    case 'cached':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
    default:
      return undefined;
  }
}
