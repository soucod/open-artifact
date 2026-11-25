import { entryLooksOf } from './entry-looks.ts';
import { conditionalFormatsGivenNow } from '../format/conditional/pane-reducer.ts';
import { drawnFormatsOf } from '../format/conditional/drawn-looks.ts';
import { isHeaderGrayHidden } from '../grid/header-gray-fill.ts';
import { NO_CELL_COLORS } from '../format/cell-colors.ts';
import { usersOfCell, cellPlainText } from '../model/cell-values.ts';
import { placedTablesOfSheet, hasTableHeadings } from '../tables/finding.ts';
import { activeAnchorCell, isSameCell } from '../selection/model.ts';
import { withEntryText } from './text-looks.ts';
import { addTextPrefixQuote } from '../model/cell-text.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState, WordsOffered } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellEntryTyped, KeyPress, WordsOfferedPressed, WordsOfferedShown } from '../state/event-reducer.ts';
import type { PlacedTableOnSheet } from '../grid/sticky-headers.ts';
import type { TableIndexRun } from '../selection/table-select.ts';
export function isCellPlainForWordsOffer(state: PageState, reads: ReadsWithTextMeasurer, cellRef: CellId): boolean {
  let position = reads.positionOfCell(cellRef);
  if (position === null || entryLooksOf(state.mode) !== undefined) return false;
  let { sheetId } = cellRef;
  let formats = sheetId === state.sheetId ? conditionalFormatsGivenNow(state, reads) : reads.formatsGivenIn(sheetId);
  let look = drawnFormatsOf(reads, sheetId, formats).lookOf(cellRef, position);
  let paints = isHeaderGrayHidden(state, reads, cellRef, position, look) ? NO_CELL_COLORS : look.paints;
  let { numberFormat, cellControl } = look.format;
  let isTimeFormat =
    numberFormat.kind === 'date' || numberFormat.kind === 'dateAndTime' || numberFormat.kind === 'time' || numberFormat.kind === 'duration';
  return (
    cellControl.kind !== 'dropdown' &&
    !isTimeFormat &&
    usersOfCell(reads.cellOf(cellRef)).length === 0 &&
    paints.fill === null &&
    paints.text === null
  );
}
export function isWordsOfferFor(typed: string, candidate: string): boolean {
  let rest = candidate.slice(typed.length);
  return (
    candidate.slice(0, typed.length).toLowerCase() === typed.toLowerCase() &&
    /^\P{M}/u.test(rest) &&
    /[^\s\p{M}\p{Cf}]/u.test(rest) &&
    candidate.length <= MAX_OFFERED_WORDS_LENGTH &&
    candidate.trim() === candidate &&
    !/[\r\n]/.test(candidate) &&
    !RTL_TEXT_PATTERN.test(candidate)
  );
}
export function headingRowTest(
  state: Pick<PageState, 'tablesRead'>,
  reads: WorkbookReads,
  { sheetId }: Pick<CellId, 'sheetId'>,
  columnIndex: number,
): (rowIndex: number) => boolean {
  let headings: TableIndexRun[] = placedTablesOfSheet(state, reads, sheetId).all.flatMap(
    ({ table, header, columns }: PlacedTableOnSheet) =>
      hasTableHeadings(table) && columnIndex >= columns.first && columnIndex <= columns.last ? [header] : [],
  );
  return (rowIndex: number) => headings.some(({ first, last }) => rowIndex >= first && rowIndex <= last);
}
export function wordsToOfferAt(typed: string, state: Pick<PageState, 'tablesRead'>, reads: WorkbookReads, cellRef: CellId): string | null {
  let position = reads.positionOfCell(cellRef);
  if (position === null) return null;
  let isHeadingRow = headingRowTest(state, reads, cellRef, position.columnIndex);
  let offered: string | null = null;
  for (let distance = 1; distance <= MAX_ROWS_SEARCHED_FOR_WORDS; distance += 1)
    for (let rowIndex of [position.rowIndex - distance, position.rowIndex + distance]) {
      let cellId = isHeadingRow(rowIndex) ? null : reads.cellIdAt(cellRef.sheetId, rowIndex, position.columnIndex);
      let text = cellId === null ? null : cellPlainText(reads.cellOf(cellId));
      if (text !== null && isTypedInFull(typed, text)) return null;
      if (text !== null && offered === null && isWordsOfferFor(typed, text)) offered = text;
    }
  return offered;
}
export function refreshWordsOffered(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { text, isOpenToOffer }: Pick<CellEntryTyped, 'text' | 'isOpenToOffer'>,
): PageState {
  let { mode, wordsOffered } = state;
  if (mode.kind !== 'editing' || mode.typingIn !== 'cell' || mode.text !== text) return state;
  if (mode.isExpanded === true) return state;
  let cellId = activeAnchorCell(state, reads);
  let offered =
    isOpenToOffer && mayOfferWordsFor(text) && isCellPlainForWordsOffer(state, reads, cellId) ? wordsToOfferAt(text, state, reads, cellId) : null;
  if (offered === null) return withoutWordsOffered(state);
  let isShown = wordsOffered?.offered === offered && wordsOffered.isShown && !wordsOffered.isGone;
  // isShown holds only when the words offered are there.
  let isKeyDrawn = isShown && wordsOffered!.isKeyDrawn;
  return {
    ...state,
    wordsOffered: {
      cellId,
      typed: text,
      offered,
      isShown,
      isKeyDrawn,
      isGone: false,
    },
  };
}
export function matchingWordsOffered(
  state: Pick<PageState, 'mode' | 'wordsOffered'>,
  offer: Pick<WordsOfferedShown | WordsOfferedPressed, 'cellId' | 'typed' | 'offered'>,
): WordsOffered | null {
  let current = wordsOfferedNow(state);
  return current !== null && isSameCell(current.cellId, offer.cellId) && current.typed === offer.typed && current.offered === offer.offered
    ? current
    : null;
}
export function showWordsOffered(state: PageState, offer: WordsOfferedShown): PageState {
  let current = matchingWordsOffered(state, offer);
  if (current === null) return state;
  let isKeyDrawn = offer.isWithNoKey !== true;
  return {
    ...state,
    wordsOffered: {
      ...current,
      isShown: true,
      isKeyDrawn,
    },
  };
}
export function acceptWordsOffered(state: PageState): PageState {
  let offered = wordsOfferedNow(state);
  return offered === null || state.mode.kind !== 'editing'
    ? state
    : {
        ...state,
        wordsOffered: null,
        mode: withEntryText(state.mode, addTextPrefixQuote(offered.offered)),
      };
}
export function doesTabAcceptWordsOffered(state: Pick<PageState, 'mode' | 'wordsOffered'>, keyEvent: KeyPress): boolean {
  let isPlainKey = !keyEvent.isShiftHeld && !keyEvent.isModifierHeld && !keyEvent.isAltHeld && !keyEvent.isRepeat;
  let offered = wordsOfferedNow(state);
  return isPlainKey && keyEvent.key === 'Tab' && offered?.isShown === true && offered.isKeyDrawn;
}
export function keepWordsOffered(
  before: Pick<PageState, 'scrollTop' | 'scrollLeft' | 'workbookChangeCount'>,
  state: PageState,
  reads: ReadsWithTextMeasurer,
  isTypingOn: boolean,
): PageState {
  let { wordsOffered, mode } = state;
  if (wordsOffered === null) return state;
  let isStillAtCell =
    mode.kind === 'editing' &&
    mode.typingIn === 'cell' &&
    (mode.text === wordsOffered.typed || (isTypingOn && !wordsOffered.isGone)) &&
    isSameCell(wordsOffered.cellId, activeAnchorCell(state, reads)) &&
    state.menu === null &&
    state.peopleList === null &&
    state.dropdown === null;
  let isViewStill =
    state.scrollTop === before.scrollTop && state.scrollLeft === before.scrollLeft && state.workbookChangeCount === before.workbookChangeCount;
  if (!isStillAtCell) return withoutWordsOffered(state);
  let isStillOffered = wordsOffered.isGone || isCellPlainForWordsOffer(state, reads, wordsOffered.cellId);
  return isViewStill && isStillOffered ? state : hideWordsOffered(state);
}
export const MAX_ROWS_SEARCHED_FOR_WORDS = 1000;
export const MAX_OFFERED_WORDS_LENGTH = 50;
export const RTL_TEXT_PATTERN =
  /[\u0590-\u08FF\u200E\u200F\u202A-\u202E\u2066-\u2069\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;
export const isTypedInFull = (typed: string, text: string): boolean =>
  text.slice(0, typed.length).toLowerCase() === typed.toLowerCase() && text.slice(typed.length).trimEnd() === '';
export const mayOfferWordsFor = (text: string): boolean => !text.startsWith('=') && !text.startsWith('@') && /\p{L}/u.test(text);
export const wordsOfferedNow = ({ mode, wordsOffered }: Pick<PageState, 'mode' | 'wordsOffered'>): WordsOffered | null =>
  mode.kind === 'editing' && wordsOffered?.typed === mode.text && !wordsOffered.isGone ? wordsOffered : null;
export const withoutWordsOffered = (state: PageState): PageState =>
  state.wordsOffered === null
    ? state
    : {
        ...state,
        wordsOffered: null,
      };
export const hideWordsOffered = (state: PageState): PageState =>
  state.wordsOffered?.isShown === true
    ? {
        ...state,
        wordsOffered: {
          ...state.wordsOffered,
          isGone: true,
        },
      }
    : withoutWordsOffered(state);
