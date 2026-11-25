import type { SheetId } from '@open-artifact/sheets-core';
import { firstPlaceInSheet } from '../state/places.ts';
import { DEFAULT_CELL_DENSITY } from '../grid/cell-metrics-values.ts';
import { noticeGivesWay } from '../state/queries.ts';
import type { PageState, SavedPlace } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CopyLinkOutcome } from '../shell/sheet-links.ts';
import type { WorkbookReads } from '../model/workbook.ts';
export function savedPlaceForLinkedSheet(
  reads: WorkbookReads,
  sheetIdOfLink: SheetId | null,
  savedPlace: SavedPlace | null,
): SavedPlace | null {
  if (sheetIdOfLink === null || sheetIdOfLink === savedPlace?.sheetId) return savedPlace;
  let firstPlace = firstPlaceInSheet(reads, sheetIdOfLink);
  return firstPlace === null
    ? savedPlace
    : {
        ...firstPlace,
        lines: null,
        density: DEFAULT_CELL_DENSITY,
      };
}
export const copyLinkToSheet = (state: PageState, sheetId: SheetId | null): PageTransition => ({
  state:
    state.notice?.kind === 'linkNotCopied'
      ? {
          ...state,
          notice: null,
        }
      : state,
  effects: [
    {
      kind: 'copyLinkToSheet',
      sheetId: sheetId ?? state.sheetPointedIn ?? state.sheetId,
    },
  ],
});
export const noticeLinkNotCopied = (state: PageState, whyNot: CopyLinkOutcome): PageState =>
  whyNot === null || (state.notice !== null && !noticeGivesWay(state.notice))
    ? state
    : {
        ...state,
        notice: {
          kind: 'linkNotCopied',
          why: whyNot,
        },
      };
