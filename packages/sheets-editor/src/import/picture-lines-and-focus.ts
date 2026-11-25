import { importRecordCount } from './bring-in.ts';
import type { ImportOfAFile } from '../state/initial-state.ts';
/** Gives the caret to an element, the way the dialog moves it. */
export type GiveFocus = (target: HTMLElement) => void;
export function focusIfStillWanted(target: HTMLElement | null, isStillWanted: () => boolean, focus: GiveFocus): boolean {
  if (!isStillWanted()) return false;
  if (target !== null) focus(target);
  return true;
}
export function pendingFocusTarget(
  preferred: HTMLElement | null,
  fallback: HTMLElement | null,
  isKeyboardAway: () => boolean,
  focus: GiveFocus,
): HTMLElement | false {
  if (fallback === null) return false;
  let target = preferred?.isConnected === true ? preferred : fallback;
  if (!isKeyboardAway()) return target;
  focus(target);
  return false;
}
export const importPictureLineCount = (open: ImportOfAFile, rowsShown: number, linesUnfolded: number) =>
  1 + Math.min(importRecordCount(open), rowsShown) + linesUnfolded;
export const fileLineOfRowNumber = (headerLine: number | null, linesOfFirstRows: number[], rowNumber: number): number | null =>
  rowNumber === 1 ? headerLine : (linesOfFirstRows[rowNumber - 2] ?? null);
