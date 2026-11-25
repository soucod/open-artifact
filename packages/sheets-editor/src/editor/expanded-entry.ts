import { activeAnchorCell, scrollToShowActiveCell } from '../selection/model.ts';
import { cardBeingShown } from '../state/list-cards.ts';
import { canCellEntryExpand, textToEditAt, stopArrowsActingOnCells, startEntryEditing, doesEntryTakeLineBreaks } from './start-entry.ts';
import { hasEntryLists, entryListsOf } from './entry-looks.ts';
import { cellPlainText } from '../model/cell-values.ts';
import { startsWithListStarter } from './text-looks.ts';
import { lineCountWithListGaps } from '../grid/cell-metrics.ts';
import { lineCountOfEntry } from './entry-lines.ts';
import { rowHeightForLines } from '../grid/cell-metrics-values.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { filterButtonAtActiveCell } from '../tables/own-filter-list.ts';
import type { FontToMeasure, ReadsWithTextMeasurer } from '../state/controller.ts';
import type { EditingMode, PageMode } from '../state/transitions.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
/** Where the expanded entry's card and its text go, and how many lines the text takes. */
export interface ExpandedEntryLayout {
  card: PaneRect;
  text: PaneRect;
  lineCount: number;
}
export function expandEntry(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let cell = activeAnchorCell(state, reads);
  if (cardBeingShown(state) !== null || !canCellEntryExpand(reads, cell)) return state;
  let text = state.mode.kind === 'editing' ? state.mode.text : textToEditAt(state, reads, cell);
  let isTypingInCell = state.mode.kind === 'editing' && state.mode.typingIn === 'cell';
  let started = stopArrowsActingOnCells(isTypingInCell ? state : startEntryEditing(state, reads, text, 'cell'));
  if (started.mode.kind !== 'editing' || !canEntryExpandNow(started, reads)) return state;
  return scrollToShowActiveCell(
    {
      ...started,
      mode: {
        ...started.mode,
        isExpanded: true,
      },
      wordsOffered: null,
      lastDone: {
        what: 'entryExpanded',
      },
    },
    reads,
  );
}
export function collapseEntry(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  if (state.mode.kind !== 'editing' || state.mode.isExpanded !== true) return state;
  let { isExpanded, ...mode } = state.mode;
  return scrollToShowActiveCell(
    {
      ...state,
      mode,
      lastDone: {
        what: 'entryCollapsed',
      },
    },
    reads,
  );
}
export function isExpandOfferedInEntry(state: PageState, reads: WorkbookReads): boolean {
  let { mode } = state;
  if (mode.kind !== 'editing' || mode.isExpanded === true) return false;
  if (mode.text === '' && !hasEntryLists(mode)) return false;
  let cellId = activeAnchorCell(state, reads);
  if (!canCellEntryExpand(reads, cellId)) return false;
  let cell = reads.cellOf(cellId);
  let isPlainTyping = mode.arrowsActOn !== 'cells' && (cell === null || cellPlainText(cell) !== null || mode.isTypedOverCell === true);
  return (
    (mode.text.includes(`
`) ||
      hasEntryLists(mode) ||
      startsWithListStarter(mode.text) ||
      isPlainTyping) &&
    canEntryExpandNow(state, reads)
  );
}
export function expandedEntryLayout(
  mode: EditingMode,
  cellBox: Pick<PaneRect, 'left' | 'top' | 'width'>,
  viewSize: Pick<PaneRect, 'width' | 'height'>,
  font: FontToMeasure,
  workbook: ReadsWithTextMeasurer,
): ExpandedEntryLayout {
  let room = {
    width: Math.max(0, viewSize.width - EXPANDED_ENTRY_VIEW_GAP),
    height: Math.max(0, viewSize.height - EXPANDED_ENTRY_VIEW_GAP),
  };
  let width = Math.min(Math.max(EXPANDED_ENTRY_MIN_WIDTH, cellBox.width), room.width);
  let textWidth = Math.max(0, width - EXPANDED_ENTRY_SIDE_ROOM);
  let { left, right } = EXPANDED_ENTRY_PADDING;
  let lists = entryListsOf(mode);
  let wrapWidth = Math.max(0, textWidth - left - right);
  let lineCount = lineCountWithListGaps(lineCountOfEntry(mode.text, font, wrapWidth, workbook, lists), lists?.length ?? 1, font.size);
  let textHeight = rowHeightForLines(Math.max(lineCount, EXPANDED_ENTRY_MIN_LINES), font.size, EXPANDED_ENTRY_PADDING);
  let height = Math.min(textHeight + EXPANDED_ENTRY_FOOT_HEIGHT, room.height);
  let cardLeft = clampIntoRoom(cellBox.left, width, room.width);
  let cardTop = clampIntoRoom(cellBox.top, height, room.height);
  return {
    card: {
      left: cardLeft,
      top: cardTop,
      width,
      height,
    },
    text: {
      left: cardLeft,
      top: cardTop,
      width: textWidth,
      height: Math.max(0, height - EXPANDED_ENTRY_FOOT_HEIGHT),
    },
    lineCount,
  };
}
export const isEntryExpanded = (mode: PageMode): boolean => mode.kind === 'editing' && mode.isExpanded === true;
export const canEntryExpandNow = (state: PageState, reads: WorkbookReads): boolean =>
  state.mode.kind === 'editing' &&
  !state.isOnPhone &&
  !isFormulaText(state.mode.text) &&
  doesEntryTakeLineBreaks(state, reads) &&
  cardBeingShown(state) === null &&
  state.calendar === null;
export const isExpandOfferedAtActiveCell = (state: PageState, reads: ReadsWithTextMeasurer): boolean =>
  !state.isOnPhone &&
  cellPlainText(reads.cellOf(state.activeCell)) !== null &&
  canCellEntryExpand(reads, state.activeCell) &&
  filterButtonAtActiveCell(state, reads, state.activeCell) === null;
export const EXPAND_BUTTON_SIZE = 20;
export const EXPAND_BUTTON_ROOM = EXPAND_BUTTON_SIZE + 3;
export const EXPANDED_ENTRY_MIN_WIDTH = 480;
export const EXPANDED_ENTRY_MIN_LINES = 8;
export const EXPANDED_ENTRY_SIDE_ROOM = 28;
export const EXPANDED_ENTRY_FOOT_HEIGHT = 36;
export const EXPANDED_ENTRY_VIEW_GAP = 8;
export const EXPANDED_ENTRY_PADDING = {
  over: 10,
  under: 4,
  left: 12,
  right: 4,
};
export const clampIntoRoom = (start: number, size: number, room: number): number => Math.max(0, Math.min(start, room - size));
