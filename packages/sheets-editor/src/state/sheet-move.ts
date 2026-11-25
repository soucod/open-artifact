import type { SheetId } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { PageTransition } from './transitions.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import { withNoEffects } from './transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
export function moveSheetToPlace(state: PageState, reads: WorkbookReads, sheetId: SheetId, toIndex: number): PageTransition {
  let sheets = reads.listSheets();
  let otherSheets = sheets.filter((sheet) => sheet.sheetId !== sheetId);
  if (otherSheets.length === sheets.length) return withNoEffects(state);
  let afterSheet = otherSheets[Math.min(toIndex, otherSheets.length) - 1]?.sheetId ?? null;
  return queueEdit(
    state,
    {
      kind: 'moveSheet',
      sheetId,
      afterSheet,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
    },
  );
}
export function lastDoneOfSheetMove(reads: WorkbookReads, sheetId: SheetId): SheetMoved | null {
  let sheets = reads.listSheets();
  let sheetIndex = sheets.findIndex((sheet) => sheet.sheetId === sheetId);
  let name = sheets[sheetIndex]?.name;
  return name === undefined
    ? null
    : {
        what: 'sheetMoved',
        name,
        place: sheetIndex + 1,
        sheetCount: sheets.length,
      };
}
/** What was done last, when a sheet was moved: told to screen readers as its place among the sheets. */
export interface SheetMoved {
  what: 'sheetMoved';
  name: string;
  place: number;
  sheetCount: number;
}
