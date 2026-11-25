import { LIGHT_GRAY_HEX } from '../model/cell-format.ts';
import { isModalOpen } from '../ui/find.ts';
import type { LookOfAnImportedTable } from '@open-artifact/sheets-core';
import type { FileAwaited, Notice, PageState, UndoOffer } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
export function carryFileAwaited(state: PageState, transition: PageTransition): PageTransition {
  let { fileAwaited } = state;
  let { state: nextState } = transition;
  if (fileAwaited === null) return transition;
  if (nextState.importOfAFile !== null)
    return {
      ...transition,
      state: {
        ...nextState,
        fileAwaited: null,
      },
    };
  if (nextState.notice === state.notice) return transition;
  let carried = {
    ...fileAwaited,
    whyNot: nextState.notice,
    refusedCount: fileAwaited.refusedCount + 1,
  };
  return {
    ...transition,
    state: {
      ...nextState,
      notice: state.notice,
      fileAwaited: carried,
    },
  };
}
export function importedSheetLook(headerNames: string[]): LookOfAnImportedTable {
  let firstBlank = headerNames.indexOf('');
  return {
    kind: 'headerFrozenAndFilled',
    headerFill: {
      kind: 'rgb',
      hex: LIGHT_GRAY_HEX,
    },
    leastWidthsInPixels: (firstBlank === -1 ? headerNames : headerNames.slice(0, firstBlank)).map(
      ({ length }) =>
        Math.min(WIDEST_HEADER_PIXELS, Math.ceil(length * HEADER_WIDTH_PIXELS.ofACharacter) + HEADER_WIDTH_PIXELS.besideText),
    ),
    widestForATextInPixels: WIDEST_HEADER_PIXELS,
  };
}
export const HEADER_WIDTH_PIXELS = {
  ofACharacter: 7.6,
  besideText: 44,
};
export const WIDEST_HEADER_PIXELS = 360;
export const withoutImportUndoOffer = (undoOffer: UndoOffer | null) =>
  undoOffer?.kind === 'tableImportedAsNewSheet' || undoOffer?.kind === 'tableImportedIntoSheet' ? null : undoOffer;
export const awaitFileToImport = (state: PageState, isAskedByKey: boolean): PageState =>
  isModalOpen(state)
    ? state
    : {
        ...state,
        menu: null,
        lastDone: null,
        notice: null,
        undoOffer: withoutImportUndoOffer(state.undoOffer),
        fileAwaited: {
          isAskedByKey,
          whyNot: null,
          refusedCount: 0,
        },
      };
export const awaitFileAgain = (state: PageState, fileAwaited: FileAwaited | null, whyNot: Notice): PageState => ({
  ...state,
  menu: null,
  pickForWorkbook: null,
  isListOfKeysOpen: false,
  cellHistory: null,
  lastDone: null,
  notice: fileAwaited === null ? null : state.notice,
  undoOffer: withoutImportUndoOffer(state.undoOffer),
  fileAwaited: {
    isAskedByKey: fileAwaited?.isAskedByKey ?? false,
    whyNot,
    refusedCount: (fileAwaited?.refusedCount ?? 0) + 1,
  },
});
