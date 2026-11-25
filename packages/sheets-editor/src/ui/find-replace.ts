import type { DecimalSignName, Edit, EditOf, SheetId, TextPasted, TextThatNoCellShows } from '@open-artifact/sheets-core';
import {
  textMatchesFind,
  MAX_FIND_SHOWN_CHARACTERS,
  isFindHit,
  numberTextMatchesFind,
  findQueryOf,
  isModalOpen,
  findHitsReadyToStep,
  indexOfActiveFindHit,
  stepFindHit,
} from './find.ts';
import { formulaTextOf, cellInputText, cellValueOf } from '../model/cell-values.ts';
import { stripTextPrefixQuote, textAsTypedInput, sanitizeCellText } from '../model/cell-text.ts';
import { stripGroupSeparators, parsePlainNumber } from '../format/number-signs.ts';
import { shownCellText } from '../format/shown-text.ts';
import { cellRefOf, isFormulaCell } from '../model/workbook.ts';
import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { withoutOtherRanges } from '../selection/several-ranges.ts';
import { selectionAtCell } from '../selection/model.ts';
import { shownCellOf } from '../grid/formulas-shown.ts';
import { makeIsCellFilteredOut } from '../tables/filtered-rows.ts';
import type { CellsCountedOffer, Find, FindOptions, PageState, UndoOffer } from '../state/initial-state.ts';
import type { CellId, CellOnShow, WorkbookReads } from '../model/workbook.ts';
import type { IfQueued, PageContext, ReplaceChosen } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { FindQuery } from './find.ts';
/** What a cell's text becomes under a replace: unchanged, left out, or the text to write. */
export type ReplacementOfCell = 'same' | 'skipped' | { write: string };
/** A replace in every cell as it was asked, kept to count the matches left once its edit is answered. */
export interface ReplaceAllAsked {
  sheetId: SheetId;
  areFormulasShown: boolean;
  asked: { text: string; options: FindOptions };
  /** The replacement text. */
  text: string;
  /** The text each skipped formula cell showed, by `findCellKeyOf`. */
  shownByFormulas: Map<string, string>;
}
/** How a replace edit is queued: with the replace in every cell it came from, when there was one. */
export interface IfQueuedOfReplace extends IfQueued {
  ofReplaceAll?: ReplaceAllAsked;
}
/** The texts a replace in every cell writes, the matches it leaves, and the text shown by the formula cells it skipped. */
export interface ReplaceAllFound {
  cells: TextPasted[];
  leftCount: number;
  shownByFormulas: Map<string, string>;
}
export function replaceInFormulaText(formulaText: string, pattern: RegExp, replacement: string): ReplacementOfCell {
  let replaced = formulaText.replaceAll(pattern, () => replacement);
  if (replaced === formulaText) return 'same';
  return /^=\s*\S/u.test(replaced)
    ? {
        write: replaced,
      }
    : 'skipped';
}
export function isMatchInHiddenFormula(
  { areFormulasShown }: Pick<PageState, 'areFormulasShown'>,
  reads: WorkbookReads,
  cellId: CellId,
  find: FindQuery,
): boolean {
  if (!find.isInFormulas || areFormulasShown) return false;
  let cell = reads.cellOf(cellId);
  return cell?.input.kind === 'formula' && textMatchesFind(formulaTextOf(cell), find);
}
export function replacementOfCell(
  state: PageState,
  reads: WorkbookReads,
  cellId: CellId,
  find: FindQuery,
  pattern: RegExp,
  replacement: string,
): ReplacementOfCell {
  let cell = reads.cellOf(cellId);
  if (cell === null || reads.formatOf(cellId).cellControl.kind !== 'none') return 'skipped';
  let { kind: inputKind } = cell.input;
  if (inputKind === 'formula' && state.areFormulasShown) return replaceInFormulaText(formulaTextOf(cell), pattern, replacement);
  if (isMatchInHiddenFormula(state, reads, cellId, find)) return replaceInFormulaText(formulaTextOf(cell), pattern, replacement);
  if (inputKind !== 'text' && inputKind !== 'number' && inputKind !== 'boolean') return 'skipped';
  let { decimalSign } = reads;
  let inputText = cellInputText(cell, decimalSign);
  let isTextShownOtherwise = cell.input.kind === 'text' && inputText !== cell.input.value;
  let textToSearch = isTextShownOtherwise ? stripTextPrefixQuote(inputText) : inputText;
  let shownText = stripGroupSeparators(shownCellText(cell, MAX_FIND_SHOWN_CHARACTERS, decimalSign).text, decimalSign);
  if (inputKind === 'number' && !shownText.includes(textToSearch.replace(/^-/u, '').replace(/%$/u, ''))) return 'skipped';
  let replaced = textToSearch.replaceAll(pattern, () => replacement);
  if (replaced === textToSearch) return textToSearch.search(pattern) === -1 ? 'skipped' : 'same';
  let typedBack = textAsTypedInput(replaced, decimalSign);
  let isTextFormat = reads.formatOf(cellId).numberFormat.kind === 'text';
  if (isTextShownOtherwise)
    return typedBack === replaced && /\d/u.test(replaced) && !isTextFormat
      ? 'skipped'
      : {
          write: typedBack,
        };
  let written =
    inputKind === 'number' && textToSearch.endsWith('%') && parsePlainNumber(replaced, decimalSign) !== null ? `${replaced}%` : replaced;
  return written === inputText
    ? 'skipped'
    : {
        write: written,
      };
}
export function* cellsToSearch(state: PageState, reads: WorkbookReads, find: FindQuery): Generator<CellId, void, undefined> {
  let { sheetId } = state;
  let rowCount = reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.rowCount ?? 0;
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1)
    for (let columnIndex of reads.columnIndexesOnShowIn(sheetId, rowIndex)) {
      let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
      if (
        cellId === null ||
        !isFindHit(
          state,
          reads,
          {
            cellId,
            rowIndex,
            columnIndex,
          },
          find,
        )
      )
        continue;
      let mergedArea = reads.mergedAreaAt(sheetId, {
        rowIndex,
        columnIndex,
      });
      if (mergedArea === null || (mergedArea.topRowIndex === rowIndex && mergedArea.leftColumnIndex === columnIndex)) yield cellId;
    }
}
export function replaceAllEdits(state: PageState, reads: WorkbookReads, find: FindQuery, replacement: string): ReplaceAllFound | null {
  let pattern = findPatternOf(find.text, find);
  let cells: TextPasted[] = [];
  let shownByFormulas = new Map<string, string>();
  let leftCount = 0;
  let isOutOfScope = outOfFindScope(state, reads, find);
  for (let cellId of cellsToSearch(state, reads, find)) {
    if (isOutOfScope(cellId)) {
      leftCount += 1;
      continue;
    }
    let outcome = replacementOfCell(state, reads, cellId, find, pattern, replacement);
    if (outcome === 'skipped') leftCount += 1;
    if (outcome === 'skipped' && isMatchInShownCell(state, reads, cellId, find))
      shownByFormulas.set(findCellKeyOf(cellId), shownTextOf(reads, cellId));
    if (typeof outcome === 'string') continue;
    if (
      cells.push({
        ...cellRefOf(cellId),
        text: outcome.write,
      }) > MAX_CELLS_REPLACED
    )
      return null;
  }
  return {
    cells,
    leftCount,
    shownByFormulas,
  };
}
export function isStillMatching(cell: CellOnShow | null, find: FindQuery, pattern: RegExp, decimalSign: DecimalSignName): boolean {
  let shownText = shownCellText(cell, MAX_FIND_SHOWN_CHARACTERS, decimalSign).text.replaceAll(
    pattern,
    `
`,
  );
  if (textMatchesFind(shownText, find)) return true;
  return cellValueOf(cell)?.kind === 'number' && numberTextMatchesFind(shownText, find, decimalSign);
}
export function countLeftAfterReplaceAll(
  { undoOffer, ofReplaceAll }: IfQueuedOfReplace,
  state: PageState,
  { reads, areFormulasLeft }: PageContext,
): UndoOffer | null | undefined {
  if (undoOffer?.kind !== 'replacedInCells' || ofReplaceAll === undefined || areFormulasLeft) return undoOffer;
  let { sheetId, areFormulasShown, asked, text, shownByFormulas } = ofReplaceAll;
  let find = findQueryOf(asked, reads, sheetId);
  let stateAsAsked: PageState = {
    ...state,
    sheetId,
    areFormulasShown,
  };
  let pattern = text === '' ? null : findPatternOf(text, find);
  let { leftCount } = undoOffer;
  let isOutOfScope = outOfFindScope(stateAsAsked, reads, find);
  for (let cellId of cellsToSearch(stateAsAsked, reads, find)) {
    if (isOutOfScope(cellId) || !isMatchInShownCell(stateAsAsked, reads, cellId, find)) continue;
    if (
      pattern === null ||
      shownByFormulas.get(findCellKeyOf(cellId)) === shownTextOf(reads, cellId) ||
      isStillMatching(reads.cellOnShowIn(cellId), find, pattern, reads.decimalSign)
    )
      leftCount += 1;
  }
  return {
    ...undoOffer,
    leftCount,
  };
}
export function replaceInEveryCell(
  state: PageState,
  { reads, areFormulasLeft }: PageContext,
  find: Find,
  replacement: string,
): PageTransition {
  let findInSheet = findQueryOf(find, reads, state.sheetId);
  let found = replaceAllEdits(state, reads, findInSheet, replacement);
  if (found === null)
    return withNoEffects({
      ...state,
      notice: {
        kind: 'editRefused',
        why: 'tooLargeForOneEdit',
        asked: 'otherEdit',
      },
    });
  let { cells, leftCount, shownByFormulas } = found;
  let leftNotShown = leftCount - shownByFormulas.size;
  if (cells.length === 0) {
    let countLeft = areFormulasLeft ? leftNotShown : leftCount;
    return withNoEffects(
      countLeft === 0
        ? state
        : {
            ...state,
            notice: {
              kind: 'matchesNotReplaced',
              count: countLeft,
            },
          },
    );
  }
  return queueEdit(
    {
      ...state,
      lastDone: null,
    },
    pasteTextsEdit(state, reads, cells),
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
      ...(isFindOverWholeSheet(findInSheet) && {
        reachesRowsOutOfView: true,
      }),
      undoOffer: {
        kind: 'replacedInCells',
        count: cells.length,
        leftCount: leftNotShown,
      },
      ...(!areFormulasLeft && {
        ofReplaceAll: {
          sheetId: state.sheetId,
          areFormulasShown: state.areFormulasShown,
          asked: {
            text: find.text,
            options: find.options,
          },
          text: replacement,
          shownByFormulas,
        },
      }),
      thenEvent: {
        kind: 'findLookedAgain',
      },
    } satisfies IfQueuedOfReplace,
  );
}
export function dropReplacementsNotShown(
  state: PageState,
  edit: Edit,
  textThatNoCellShows: TextThatNoCellShows[] | 'tooMany',
  ifQueued: IfQueuedOfReplace,
): PageTransition | null {
  let { done, undoOffer, ofReplaceAll } = ifQueued;
  if (edit.kind !== 'pasteTexts') return null;
  let unshownKeys = new Set<string>(textThatNoCellShows === 'tooMany' ? [] : textThatNoCellShows.map(findCellKeyOfRc));
  let unshownTexts = new Set<string>(
    edit.cells.filter((cell) => unshownKeys.has(findCellKeyOfRc(cell))).map(({ text }) => text),
  );
  let keptCells = edit.cells.filter(
    ({ text }) => (textThatNoCellShows === 'tooMany' ? !text.startsWith('=') : !unshownTexts.has(text)),
  );
  let droppedCount = edit.cells.length - keptCells.length;
  if (droppedCount === 0) return null;
  if (done === 'replaced')
    return withNoEffects({
      ...state,
      notice: {
        kind: 'matchesNotReplaced',
        count: 1,
      },
    });
  if (undoOffer?.kind !== 'replacedInCells') return null;
  let leftCount = undoOffer.leftCount + droppedCount;
  if (keptCells.length === 0) {
    let notReplacedCount = leftCount + (ofReplaceAll?.shownByFormulas.size ?? 0);
    return withNoEffects({
      ...state,
      notice: {
        kind: 'matchesNotReplaced',
        count: notReplacedCount,
      },
    });
  }
  return queueEdit(
    state,
    {
      ...edit,
      cells: keptCells,
    },
    {
      ...ifQueued,
      undoOffer: {
        ...undoOffer,
        count: keptCells.length,
        leftCount,
      },
    },
  );
}
export function replaceFound(state: PageState, context: PageContext, { text, where }: Pick<ReplaceChosen, 'text' | 'where'>): PageTransition {
  let { reads, areFormulasLeft } = context;
  let { mode, dragging, find } = state;
  if (mode.kind !== 'navigating' || isModalOpen(state) || dragging !== null || find === null || find.text === '') return withNoEffects(state);
  let [findInSheet, replacement] = [findQueryOf(find, reads, state.sheetId), sanitizeCellText(text)];
  if (where === 'everyCell') return replaceInEveryCell(state, context, find, replacement);
  let stateLooked = findHitsReadyToStep(state, 1, reads);
  let outcome =
    indexOfActiveFindHit(stateLooked) === null
      ? 'same'
      : replacementOfCell(stateLooked, reads, stateLooked.activeCell, findInSheet, findPatternOf(findInSheet.text, findInSheet), replacement);
  if (typeof outcome === 'string') {
    let stateStepped = stepFindHit(stateLooked, 1, reads);
    let notice: PageState['notice'] = {
      kind: 'matchesNotReplaced',
      count: 1,
    };
    let isNoticeShown =
      outcome === 'skipped' && !(areFormulasLeft && isMatchInShownCell(stateLooked, reads, stateLooked.activeCell, findInSheet));
    return withNoEffects(
      isNoticeShown
        ? {
            ...stateStepped,
            notice,
          }
        : stateStepped,
    );
  }
  let stateAtCell: PageState = {
    ...withoutOtherRanges(stateLooked),
    ...selectionAtCell(stateLooked.activeCell),
  };
  return queueEdit(
    stateAtCell,
    pasteTextsEdit(stateLooked, reads, [
      {
        ...cellRefOf(stateLooked.activeCell),
        text: outcome.write,
      },
    ]),
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: 'replaced',
      thenEvent: {
        kind: 'findStepped',
        by: 1,
      },
    },
  );
}
export const REGEX_SPECIAL_PATTERN = /[.*+?^${}()|[\]\\]/g;
export const findPatternOf = (text: string, { matchesCase }: Pick<FindQuery, 'matchesCase'>): RegExp =>
  new RegExp(text.replaceAll(REGEX_SPECIAL_PATTERN, String.raw`\$&`), matchesCase ? 'gu' : 'giu');
export const MAX_CELLS_REPLACED = 3000;
export const findCellKeyOf = ({ rowId, columnId }: Pick<CellId, 'rowId' | 'columnId'>): string => `${rowId} ${columnId}`;
export const shownTextOf = (reads: WorkbookReads, cellId: CellId): string =>
  shownCellText(reads.cellOnShowIn(cellId), MAX_FIND_SHOWN_CHARACTERS, reads.decimalSign).text;
export const isMatchInShownCell = (state: Pick<PageState, 'areFormulasShown'>, reads: WorkbookReads, cellId: CellId, find: FindQuery): boolean =>
  isFormulaCell(reads, cellId) &&
  shownCellOf(state, reads, cellId) === reads.cellOnShowIn(cellId) &&
  !isMatchInHiddenFormula(state, reads, cellId, find);
export const isFindOverWholeSheet = ({ within }: Pick<FindQuery, 'within'>): boolean => within === null;
export const outOfFindScope = (state: PageState, reads: WorkbookReads, find: FindQuery): ((cellId: CellId) => boolean) =>
  isFindOverWholeSheet(find) ? () => false : makeIsCellFilteredOut(state, reads);
export const pasteTextsEdit = (state: PageState, reads: WorkbookReads, cells: readonly TextPasted[]): EditOf<'pasteTexts'> => ({
  kind: 'pasteTexts',
  sheetId: state.sheetId,
  cells: [...cells],
  pastedTextIs: 'asTyped',
  localeOfTexts: reads.locale,
});
export const findCellKeyOfRc = ({ r: rowId, c: columnId }: Pick<TextPasted, 'r' | 'c'>): string => `${rowId} ${columnId}`;
