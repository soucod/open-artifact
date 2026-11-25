import { hasUnsavedSidePaneTyping } from '../chips/dropdown-pane-edits.ts';
import { isModalOpen } from '../ui/find.ts';
import { isNothingOpenButPane } from '../state/edit-refusals.ts';
import type { PageState, XlsxFileSaved } from '../state/initial-state.ts';
export function withXlsxFileSaved(state: PageState, saved: XlsxFileSaved): PageState {
  let isToBeToldOf = saved.went === 'sentToGoogleSheets' || saved.notCarriedOver.length > 0;
  return {
    ...state,
    xlsxFileReady: null,
    xlsxFileYetToBeToldOf: isToBeToldOf ? saved : null,
  };
}
export function withXlsxFileToldWhenFree(state: PageState): PageState {
  let { xlsxFileYetToBeToldOf } = state;
  if (xlsxFileYetToBeToldOf === null) return state;
  return state.mode.kind === 'editing' ||
    state.dragging !== null ||
    hasUnsavedSidePaneTyping(state) ||
    isModalOpen(state) ||
    !isNothingOpenButPane(state)
    ? state
    : {
        ...state,
        xlsxFileReady: xlsxFileYetToBeToldOf,
        xlsxFileYetToBeToldOf: null,
      };
}
export const withXlsxFileToldLater = (state: PageState): PageState =>

  state.xlsxFileReady === null
    ? state
    : {
        ...state,
        xlsxFileReady: null,
        xlsxFileYetToBeToldOf: state.xlsxFileReady,
      };
