/**
 * The Shell's save badge for the deck's save state: `saving` while edits wait out the save debounce or are being
 * written, `reconnecting` while a save that failed is retried. A deck never reports `unsaved`: its failed saves keep
 * retrying by themselves.
 */

import type { ChromeReport } from '@open-artifact/runtime';
import type { ProjectSaveState } from '@open-artifact/editor-kit';

/** The Shell's save badge for a deck's save state. */
export function shellSaved(save: ProjectSaveState): NonNullable<ChromeReport['saved']> {
  switch (save) {
    case 'saved':
      return 'saved';
    case 'saving':
      return 'saving';
    // Edits waiting out the save debounce: on their way, not failed (a failed save is `offline`).
    case 'dirty':
      return 'saving';
    case 'offline':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
  }
}
