import { areasOfAllRanges } from '../selection/several-ranges.ts';
import { makeIsCellFilteredOut } from '../tables/filtered-rows.ts';
import { cellRefOf, areaRefBetween } from '../model/workbook.ts';
import { withNoEffects } from '../state/transitions.ts';
import { isInSpan } from '../grid/geometry.ts';
import { shownCellBlockOfCorners } from '../model/cell-blocks.ts';
import { queueEdits, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { EditRefusedOnPage, PageState, UndoOffer } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellPosition } from '../selection/model.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { Edit, TextPasted } from '@open-artifact/sheets-core';
/** The first and last cell of a run of cells down a column. */
export type RunOfCells = [first: CellId, last: CellId];
/** Whether a run of cells may go on over the cell between two of its cells. */
export type JoinsRunOver = (between: CellId, position: CellPosition) => boolean;
interface CellAtPosition extends CellPosition {
  cellId: CellId;
}
export function isConvertibleText(reads: WorkbookReads, cellId: CellId): boolean {
  let cell = reads.cellOf(cellId);
  if (cell?.input.kind !== 'text' || cell.textIsEditedAfterTheMark !== true) return false;
  let { value: text } = cell.input;
  let { cellControl, numberFormat } = reads.formatOf(cellId);
  let fitsPercent = numberFormat.kind !== 'percent' || text.includes('%');
  let isCustomTextFormat = numberFormat.kind === 'text' && numberFormat.pattern !== '@';
  let digitCount = text.replaceAll(/\D/gu, '').length;
  let exponent = /\d\.?e([+-]?\d+)/iu.exec(text)?.[1];
  let isExponentTooLarge = exponent !== undefined && Math.abs(Number(exponent)) > MAX_CONVERTIBLE_EXPONENT;
  return (
    !text.includes('=') &&
    !/^\s*'/u.test(text) &&
    digitCount > 0 &&
    digitCount <= MAX_DIGITS_OF_CONVERTIBLE_TEXT &&
    !isExponentTooLarge &&
    cellControl.kind === 'none' &&
    fitsPercent &&
    !isCustomTextFormat
  );
}
export function* convertibleTextCells(state: PageState, reads: WorkbookReads): Generator<CellId, void, undefined> {
  let areas = areasOfAllRanges(state, reads);
  let seen = areas.length > 1 ? new Set<string>() : null;
  for (let area of areas)
    for (let cellId of reads.filledCellsIn(state.sheetId, area)) {
      let key = seen === null ? '' : `${cellId.rowId} ${cellId.columnId}`;
      if (seen?.has(key) === true || !isConvertibleText(reads, cellId)) continue;
      seen?.add(key);
      yield cellId;
    }
}
export function hasConvertibleTexts(state: PageState, reads: WorkbookReads): boolean {
  let isFilteredOut = makeIsCellFilteredOut(state, reads);
  for (let cellId of convertibleTextCells(state, reads)) if (!isFilteredOut(cellId)) return true;
  return false;
}
export function columnRunsOfCells(reads: WorkbookReads, cellIds: CellId[], canJoin: JoinsRunOver): RunOfCells[] {
  let cells = cellIds.flatMap((cellId) => {
    let position = reads.positionOfCell(cellId);
    return position === null
      ? []
      : [
          {
            cellId,
            ...position,
          },
        ];
  });
  cells.sort(
    (one, other) =>
      one.columnIndex === other.columnIndex ? one.rowIndex - other.rowIndex : one.columnIndex - other.columnIndex,
  );
  let runs: RunOfCells[] = [];
  let previous: CellAtPosition | undefined;
  for (let entry of cells) {
    let lastRun = runs.at(-1);
    let joins = lastRun !== undefined && previous?.columnIndex === entry.columnIndex;
    for (let rowIndex = (previous?.rowIndex ?? 0) + 1; joins && rowIndex < entry.rowIndex; rowIndex += 1) {
      let between = reads.cellIdAt(entry.cellId.sheetId, rowIndex, entry.columnIndex);
      joins =
        between !== null &&
        canJoin(between, {
          rowIndex,
          columnIndex: entry.columnIndex,
        });
    }
    if (lastRun !== undefined && joins) lastRun[1] = entry.cellId;
    else runs.push([entry.cellId, entry.cellId]);
    previous = entry;
  }
  return runs;
}
export function convertTextsToNumbers(state: PageState, reads: WorkbookReads): PageTransition {
  let isFilteredOut = makeIsCellFilteredOut(state, reads);
  let texts: TextPasted[] = [];
  let textFormatCells: CellId[] = [];
  let filteredOutCount = 0;
  for (let cellId of convertibleTextCells(state, reads)) {
    let cell = reads.cellOf(cellId);
    if (cell?.input.kind !== 'text') continue;
    if (isFilteredOut(cellId)) {
      filteredOutCount += 1;
      continue;
    }
    texts.push({
      ...cellRefOf(cellId),
      text: cell.input.value,
    });
    if (reads.formatOf(cellId).numberFormat.kind === 'text') textFormatCells.push(cellId);
    if (texts.length > MAX_TEXTS_CONVERTED)
      return withNoEffects({
        ...state,
        notice: TOO_LARGE_TO_CONVERT_NOTICE,
      });
  }
  if (texts.length === 0) return withNoEffects(state);
  let areas = areasOfAllRanges(state, reads);
  let runs = columnRunsOfCells(
    reads,
    textFormatCells,
    (cellId, { rowIndex, columnIndex }) => {
      let { numberFormat, cellControl } = reads.formatOf(cellId);
      return (
        areas.some(
          (area) =>
            isInSpan(rowIndex, area.topRowIndex, area.rowCount) && isInSpan(columnIndex, area.leftColumnIndex, area.columnCount),
        ) &&
        numberFormat.pattern === '@' &&
        cellControl.kind === 'none'
      );
    },
  );
  if (runs.length >= reads.mostEditsInAStep())
    return withNoEffects({
      ...state,
      notice: TOO_LARGE_TO_CONVERT_NOTICE,
    });
  let pasteEdit: Edit = {
    kind: 'pasteTexts',
    sheetId: state.sheetId,
    cells: texts,
    pastedTextIs: 'asTyped',
    localeOfTexts: reads.locale,
  };
  let formatEdits = runs.flatMap(([first, last]): Edit[] => {
    let cells = shownCellBlockOfCorners(state, reads, areaRefBetween(first, last));
    return cells === null
      ? []
      : [
          {
            kind: 'formatCells',
            cells,
            format: {
              numberFormat: {
                pattern: 'General',
              },
            },
          },
        ];
  });
  return queueEdits(
    {
      ...state,
      lastDone: null,
    },
    [...formatEdits, pasteEdit],
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: null,
      undoOffer: {
        kind: 'textsConverted',
        count: texts.length,
        leftCount: filteredOutCount,
      },
    },
    {
      isEachPointedAt: false,
    },
  );
}
export function textsConvertedOfferAfterEdit(offer: UndoOffer | null, edit: Edit, reads: WorkbookReads): UndoOffer | null {
  if (offer?.kind !== 'textsConverted') return offer;
  if (edit.kind !== 'pasteTexts') return null;
  let { sheetId } = edit;
  let count = edit.cells.filter(
    ({ r: rowId, c: columnId }) =>
      reads.cellOf({
        sheetId,
        rowId,
        columnId,
      })?.input.kind !== 'text',
  ).length;
  return count === 0
    ? null
    : {
        ...offer,
        count,
      };
}
export const MAX_TEXTS_CONVERTED = 3000;
export const MAX_DIGITS_OF_CONVERTIBLE_TEXT = 15;
export const MAX_CONVERTIBLE_EXPONENT = 300;
export const TOO_LARGE_TO_CONVERT_NOTICE: EditRefusedOnPage = {
  kind: 'editRefused',
  why: 'tooLargeForOneEdit',
  asked: 'otherEdit',
};
