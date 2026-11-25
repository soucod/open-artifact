import * as React from 'react';
import { lastDoneWorthKeeping } from '../state/transitions.ts';
import type { FixesCountedDone, LastDone, StepShownDone } from '../state/initial-state.ts';
import type { OwnCellLost } from '../state/own-cell-lost.ts';
import type { SheetController } from '../state/controller.ts';
import type { PageView } from '../view/page-view.ts';
/** An undo or a redo that showed another sheet. */
export type UndoShowingSheet = StepShownDone & { sheetShown: string };
/** What the announcer watches of the page. */
export type ViewOfLastDone = Pick<PageView, 'lastDone' | 'nameBoxText' | 'mode'>;
export function announcementOfLastDone(lastDone: LastDone, announced: LastDone | null): LastDone | null {
  if (shouldAnnounceInFull(lastDone, announced))
    return isUndoShowingSheet(lastDone)
      ? {
          what: 'sheetShown',
          name: lastDone.sheetShown,
        }
      : lastDone;
  return isUndoShowingSheet(lastDone)
    ? {
        what: lastDone.what,
        cells: null,
      }
    : null;
}
export function watchLastDoneToAnnounce(
  subscribe: (listener: () => void) => () => void,
  getView: () => ViewOfLastDone,
  announce: (lastDone: LastDone | null) => void,
  canAnnounce: () => boolean,
): () => void {
  let viewSeen: ViewOfLastDone = getView();
  let lastDoneHandled = viewSeen.lastDone;
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe = subscribe(() => {
    let { lastDone, nameBoxText, mode } = getView();
    if (lastDone === viewSeen.lastDone && nameBoxText === viewSeen.nameBoxText && mode === viewSeen.mode) return;
    let isSameLastDone = lastDone === viewSeen.lastDone;
    viewSeen = {
      lastDone,
      nameBoxText,
      mode,
    };
    clearTimeout(settleTimer);
    // An announceable last done is never null.
    if (!isAnnounceableLastDone(lastDone) || isUnsavedEmptying(lastDone!)) return;
    if (isSameLastDone && !isAlwaysAnnounced(lastDone)) {
      lastDoneHandled = lastDone;
      announce(null);
    }
    if (lastDone === lastDoneHandled) return;
    settleTimer = setTimeout(() => {
      lastDoneHandled = lastDone;
      // Announceable but not always announced leaves only a moved or removed own cell.
      if (isAlwaysAnnounced(lastDone) || (canAnnounce() && getView().nameBoxText === (lastDone as OwnCellOfLastDone).cell)) announce(lastDone);
    }, LAST_DONE_SETTLE_MS);
  });
  return () => {
    unsubscribe();
    clearTimeout(settleTimer);
  };
}
export function useAnnouncedLastDone(store: Pick<SheetController, 'subscribe' | 'getView'>, canAnnounce: () => boolean): LastDone | null {
  let [announcement, setAnnouncement] = React.useState<LastDone | null>(null);
  let canAnnounceNow = React.useEffectEvent(canAnnounce);
  React.useEffect(() => watchLastDoneToAnnounce(store.subscribe, store.getView, setAnnouncement, () => canAnnounceNow()), [store]);
  return announcement;
}
/** The page's own cell moved or removed under an edit not asked for here. */
type OwnCellOfLastDone = Extract<OwnCellLost, { cell: string }>;
export const isLastDoneAboutCells = (lastDone: LastDone | null): boolean =>
  lastDone?.what === 'entryEmptiedCell' ||
  lastDoneWorthKeeping({
    lastDone,
  }) !== null;
export const LAST_DONE_SETTLE_MS = 500;
export const isUndoShowingSheet = (lastDone: LastDone | null): lastDone is UndoShowingSheet =>
  (lastDone?.what === 'undone' || lastDone?.what === 'redone') && lastDone.sheetShown !== undefined;
export const isFixesDecision = (lastDone: LastDone | null): lastDone is FixesCountedDone =>
  lastDone?.what === 'fixesKept' || lastDone?.what === 'fixesDiscarded';
export const isAlwaysAnnounced = (lastDone: LastDone | null): boolean =>
  isLastDoneAboutCells(lastDone) || isUndoShowingSheet(lastDone) || isFixesDecision(lastDone);
export const isAnnounceableLastDone = (lastDone: LastDone | null): boolean =>
  isAlwaysAnnounced(lastDone) || lastDone?.what === 'ownCellMoved' || lastDone?.what === 'ownCellRemoved';
export const isUnsavedEmptying = (lastDone: LastDone): boolean => lastDone.what === 'entryEmptiedCell' && !lastDone.isSaved;
export const shouldAnnounceInFull = (lastDone: LastDone, announced: LastDone | null): boolean =>
  !isAnnounceableLastDone(lastDone) || lastDone === announced;
