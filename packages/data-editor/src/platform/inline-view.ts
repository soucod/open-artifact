/**
 * The embedded view: the dashboard's address with `#view-inline` (its own, or the Shell's, which hands the fragment
 * on), shown in a frame on another page. It reads only: no toolbar, comments, requests, presence or saving, writes
 * refused, and a page script reaches only `db` and `user`. The mode is settled once, when the editor starts, so a page
 * that later sets its own link keeps it.
 */

import { INLINE_VIEW_FRAGMENT } from '@open-artifact/protocol';
import { ArtifactError, type DbCapability } from '@open-artifact/runtime';
import type { RoleAbilities } from '@open-artifact/editor-kit';

export const INLINE_READ_ONLY_MESSAGE = 'This embedded dashboard is view-only.';

/** The parts of a window that decide the mode. */
export interface InlineViewWindow {
  readonly parent: unknown;
  readonly location: { readonly hash: string };
}

/** Embedded: inside a frame, opened at `#view-inline`. Opened on its own, the same address is the full editor. */
export function readInlineView(win: InlineViewWindow): boolean {
  return win.parent !== win && win.location.hash === INLINE_VIEW_FRAGMENT;
}

let settled: boolean | null = null;

/** Whether this editor is the embedded view, read the first time it is asked and kept. */
export function isInlineView(): boolean {
  if (settled === null) settled = typeof window !== 'undefined' && readInlineView(window);
  return settled;
}

/** The abilities left in the embedded view: none that change anything, send anything or save to the host. */
export function inlineAbilities(abilities: RoleAbilities): RoleAbilities {
  return {
    canEdit: false,
    canComment: false,
    canRemoveComments: false,
    canRestore: false,
    canAsk: false,
    canSaveToHost: false,
    canUseConnectors: abilities.canUseConnectors,
  };
}

/** The store as the embedded view uses it: reads and live changes as usual, every write refused. */
export function readOnlyDb(db: DbCapability): DbCapability {
  return {
    get: (path) => db.get(path),
    list: (collection) => db.list(collection),
    ...(db.listing ? { listing: (collection: string) => db.listing!(collection) } : {}),
    write: () => Promise.reject(new ArtifactError('not_writer', INLINE_READ_ONLY_MESSAGE)),
    onChange: (listener) => db.onChange(listener),
  };
}

/** A page asking for `#view-inline` as its own link: ignored, since that address means something else. */
export function isInlineViewLink(fragment: string): boolean {
  return `#${fragment}` === INLINE_VIEW_FRAGMENT;
}

/** Puts a page's link in the address bar, except in the embedded view, whose address has to stay as it was opened. */
export function showPageLink(fragment: string, win: Pick<Window, 'history'> = window): void {
  if (isInlineView()) return;
  try {
    win.history.replaceState(win.history.state, '', `#${fragment}`);
  } catch {
    // A sandboxed page may not change its address; the editor still hears the link.
  }
}
