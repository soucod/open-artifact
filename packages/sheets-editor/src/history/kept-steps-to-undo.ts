import type { SheetController } from '../state/controller.ts';
export function hasStoredStepsToUndo(getStorage: () => Storage): boolean {
  try {
    return getStorage().getItem(STEPS_TO_UNDO_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
/** Keeps a flag in the tab's storage while the page has steps to undo, for the next page to know of; gives the way to stop. */
export function keepStepsToUndoFlag(getStorage: () => Storage, controller: Pick<SheetController, 'subscribe' | 'getView'>): () => void {
  return controller.subscribe(() => {
    let hasStepsToUndo = controller.getView().hasStepsToUndoForNextPageToKnowOf;
    if (hasStepsToUndo === hasStoredStepsToUndo(getStorage)) return;
    try {
      if (hasStepsToUndo) getStorage().setItem(STEPS_TO_UNDO_STORAGE_KEY, '1');
      else getStorage().removeItem(STEPS_TO_UNDO_STORAGE_KEY);
    } catch {}
  });
}
export const STEPS_TO_UNDO_STORAGE_KEY = 'sheets-steps-to-undo';
