import type { SavingProgress, SavingState } from './initial-state.ts';
import type { Wait } from './calculating-shown.ts';
export function nextSavingProgress(progress: SavingProgress | null, unsavedEditCount: number): SavingProgress | null {
  if (unsavedEditCount === 0) return null;
  if (progress === null)
    return areUnsavedEditsMany(unsavedEditCount)
      ? {
          unsavedEditCount,
          mostUnsavedEditCount: unsavedEditCount,
          wait: {
            ms: 1000,
          },
          isBarUp: false,
        }
      : null;
  if (unsavedEditCount === progress.unsavedEditCount) return progress;
  return {
    ...progress,
    unsavedEditCount,
    mostUnsavedEditCount: Math.max(progress.mostUnsavedEditCount, unsavedEditCount),
    isBarUp: progress.isBarUp || (progress.wait === null && areUnsavedEditsMany(unsavedEditCount)),
  };
}
export const areUnsavedEditsMany = (unsavedEditCount: number): boolean => unsavedEditCount >= 10;
export const savingProgressAfterWait = (progress: SavingProgress | null, wait: Wait): SavingProgress | null =>
  progress === null || progress.wait !== wait
    ? progress
    : {
        ...progress,
        wait: null,
        isBarUp: areUnsavedEditsMany(progress.unsavedEditCount),
      };
export const fractionSavedToShow = (progress: SavingProgress | null, saving: SavingState): number | null =>
  progress !== null && progress.isBarUp && (saving === 'saving' || saving === 'retrying')
    ? 1 - progress.unsavedEditCount / progress.mostUnsavedEditCount
    : null;
