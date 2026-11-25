/**
 * Pages in the address bar for the Design editor: the store-free mechanics
 * are @open-artifact/editor-kit's page-link.ts (`syncPageHistory`, `pageLink`); this wires them to
 * the view and document stores. Readable links (`#artboard-<name>` and the
 * like, lib/place-link.ts) are opened here and then shown as `#page=`.
 */

import { pageOf } from '@open-artifact/design-core';
import { useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { hashForPage, pageFromHash, syncPageHistory } from '@open-artifact/editor-kit';
import { placeFromHash } from '../lib/place-link.ts';
import { pendingFit, zoomToBoards } from './viewport.ts';

const exists = (page: string): boolean => useDocument.getState().canvas.pages.some((p) => p.id === page);

/** The page named in the address when it exists on the canvas. */
export function pageInAddress(): string | null {
  const page = pageFromHash(location.hash);
  return page && exists(page) ? page : null;
}

/**
 * Opens the readable place link in the address, if there is one: its page,
 * and the artboard selected (or playing) and in view. Returns whether it did.
 */
export function openPlaceInAddress(): boolean {
  const { canvas } = useDocument.getState();
  const place = placeFromHash(location.hash, canvas);
  if (!place) return false;
  const view = useView.getState();
  const page = place.kind === 'page' ? place.page : pageOf(canvas, canvas.boards[place.path]!);
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${hashForPage('', page)}`);
  } catch {
    // Sandboxed frames may refuse history changes.
  }
  if (view.mode === 'focused') view.focus(null);
  view.setPage(page);
  if (place.kind === 'page') return true;
  if (place.kind === 'play') view.play(place.path);
  else view.select({ kind: 'objects', boards: [place.path], notes: [] });
  if (pendingFit.current) pendingFit.boards = [place.path];
  else zoomToBoards([place.path]);
  return true;
}

let started = false;

/** Keeps the address in step with the page shown. Call after the launch page is set. */
export function startPageHistory(): void {
  if (started) return;
  started = true;
  syncPageHistory({
    current: () => useView.getState().page,
    show: (page) => useView.getState().setPage(page),
    exists,
    fallback: () => useDocument.getState().canvas.pages[0]?.id ?? null,
    subscribe: (listener) => useView.subscribe((state, prev) => state.page !== prev.page && listener(state.page)),
  });
  window.addEventListener('hashchange', () => {
    openPlaceInAddress();
  });
}
