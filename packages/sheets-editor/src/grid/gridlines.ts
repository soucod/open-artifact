import { findSheetById } from './layout.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
export function toggleGridlines(state: PageState, workbook: WorkbookReads) {
  let sheetId = state.sheetPointedIn ?? state.sheetId;
  let hidesGridlines = findSheetById(workbook, sheetId)?.areGridlinesHidden !== true;
  return queueEdit(
    state,
    {
      kind: 'setSheetSettings',
      sheetId,
      settings: {
        areGridlinesHidden: hidesGridlines,
      },
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      leavesEntryOpen: true,
      done: {
        what: hidesGridlines ? 'gridlinesHidden' : 'gridlinesShown',
      },
    },
  );
}
