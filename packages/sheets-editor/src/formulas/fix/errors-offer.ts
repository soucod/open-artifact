import type { ColumnId, SheetId } from '@open-artifact/sheets-core';
import { showsRealError, errorCodeOfCell } from '../error-tells.ts';
import { isSameCell } from '../../selection/model.ts';
import { cellExplained } from '../../state/explained-under-cell.ts';
import { cellOfFixNotice } from './ask.ts';
import type { ErrorsAtOpening, ErrorsOffer, ErrorsOffered, PageState } from '../../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import type { PageEvent } from '../../state/event-reducer.ts';
import type { PackedRowCells } from '../../engine/packed-cells.ts';
/** The cells of a row, by column. */
type CellsOfRow = PackedRowCells;
/** The rows and columns the errors of a sheet lie within, and where the first error of the top row is. */
export interface AreaOfErrors {
  top: number;
  bottom: number;
  left: number;
  right: number;
  leftInTopRow: number;
}
/** How many errors a sheet shows, and the area they lie within when there are any. */
export interface ErrorCellsAround {
  count: number;
  around: AreaOfErrors | null;
}
/** A cell that shows an error, and where it is. */
export interface ErrorCell {
  cellId: CellId;
  position: CellPosition;
}
export function errorColumnIdsOfRow(row: CellsOfRow): ColumnId[] {
  if (!row.hasAnError()) return NO_ERROR_COLUMN_IDS;
  let cached = errorCellsCache.get(row);
  if (cached !== undefined) return cached;
  let columnIds = [...row]
    .filter(([, cell]) => showsRealError(cell) && errorCodeOfCell(cell) !== '#N/A')
    .map(([columnId]) => columnId);
  errorCellsCache.set(row, columnIds);
  return columnIds;
}
export function errorCellsAround(reads: WorkbookReads, sheetId: SheetId): ErrorCellsAround | null {
  let count = 0;
  for (let rowCells of reads.cellsHeldByRow(sheetId).values()) count += errorColumnIdsOfRow(rowCells).length;
  if (count > MAX_ERROR_CELLS) return null;
  let columnIndexes = new Map<ColumnId, number | null>();
  let aroundCount = 0;
  let [top, bottom, left, right, leftInTopRow] = [1 / 0, -1, 1 / 0, -1, 1 / 0];
  for (let [rowId, rowCells] of reads.cellsHeldByRow(sheetId)) {
    let errorColumnIds = errorColumnIdsOfRow(rowCells);
    let rowIndex = errorColumnIds.length === 0 ? null : reads.rowIndexOf(sheetId, rowId);
    if (rowIndex === null) continue;
    let leftInRow = 1 / 0;
    for (let columnId of errorColumnIds) {
      let columnIndex = columnIndexes.get(columnId);
      if (columnIndex === undefined) {
        columnIndex = reads.columnIndexOf(sheetId, columnId);
        columnIndexes.set(columnId, columnIndex);
      }
      if (columnIndex === null) continue;
      aroundCount += 1;
      if (columnIndex < leftInRow) leftInRow = columnIndex;
      if (columnIndex > right) right = columnIndex;
    }
    if (leftInRow === 1 / 0) continue;
    if (leftInRow < left) left = leftInRow;
    if (rowIndex > bottom) bottom = rowIndex;
    if (rowIndex < top) [top, leftInTopRow] = [rowIndex, leftInRow];
  }
  return {
    count: aroundCount,
    around:
      aroundCount === 0
        ? null
        : {
            top,
            bottom,
            left,
            right,
            leftInTopRow,
          },
  };
}
export function errorCountInArea(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, leftColumnIndex, rowCount, columnCount }: CellArea,
): number | null {
  let count = 0;
  let countInArea = 0;
  for (let [rowId, rowCells] of reads.cellsHeldByRow(sheetId)) {
    let errorColumnIds = errorColumnIdsOfRow(rowCells);
    count += errorColumnIds.length;
    if (count > MAX_ERROR_CELLS) return null;
    let rowIndex = errorColumnIds.length === 0 ? null : reads.rowIndexOf(sheetId, rowId);
    if (rowIndex === null || rowIndex < topRowIndex || rowIndex >= topRowIndex + rowCount) continue;
    for (let columnId of errorColumnIds) {
      let columnIndex = reads.columnIndexOf(sheetId, columnId);
      if (columnIndex !== null && columnIndex >= leftColumnIndex && columnIndex < leftColumnIndex + columnCount) countInArea += 1;
    }
  }
  return countInArea;
}
export function errorCellsOfSheet(reads: WorkbookReads, sheetId: SheetId): ErrorCell[] | null {
  let errorCells: ErrorCell[] = [];
  for (let [rowId, rowCells] of reads.cellsHeldByRow(sheetId))
    for (let columnId of errorColumnIdsOfRow(rowCells)) {
      let cellId = {
        sheetId,
        rowId,
        columnId,
      };
      let position = reads.positionOfCell(cellId);
      if (position !== null)
        errorCells.push({
          cellId,
          position,
        });
      if (errorCells.length > MAX_ERROR_CELLS) return null;
    }
  return errorCells;
}
export function errorsAtOpeningOf(reads: WorkbookReads, sheetId: SheetId): ErrorsAtOpening | null {
  let errors = errorCellsAround(reads, sheetId);
  if (errors === null || errors.around === null) return null;
  let { top, bottom, left, right } = errors.around;
  let [first, last] = [reads.cellIdAt(sheetId, top, left), reads.cellIdAt(sheetId, bottom, right)];
  return first === null || last === null
    ? null
    : {
        count: errors.count,
        first,
        last,
      };
}
export function errorsOffer(
  reads: WorkbookReads,
  sheetId: SheetId,
  area: AreaOfErrors,
  offerBefore: ErrorsOffer | null,
  hasWorkbookChanged: boolean,
  isForced: boolean,
): ErrorsOffer | null {
  let first = reads.cellIdAt(sheetId, area.top, area.left);
  let last = reads.cellIdAt(sheetId, area.bottom, area.right);
  let firstWithAnError = reads.cellIdAt(sheetId, area.top, area.leftInTopRow);
  if (first === null || last === null || firstWithAnError === null) return null;
  if (isForced && offerBefore !== null)
    return isSameCell(offerBefore.first, first) && isSameCell(offerBefore.last, last)
      ? offerBefore
      : {
          ...offerBefore,
          first,
          last,
        };
  if (
    !hasWorkbookChanged &&
    offerBefore !== null &&
    isSameCell(offerBefore.firstWithAnError, firstWithAnError) &&
    offerBefore.endOfTable !== null &&
    reads.positionOfCell(offerBefore.endOfTable) !== null
  )
    return isSameCell(offerBefore.first, first) && isSameCell(offerBefore.last, last)
      ? offerBefore
      : {
          ...offerBefore,
          first,
          last,
        };
  let tableEnd = reads.conditionalFormatSuggestions(firstWithAnError, firstWithAnError)?.table.cells.bottomRight;
  if (tableEnd !== undefined)
    return {
      first,
      last,
      firstWithAnError,
      endOfTable: {
        sheetId,
        rowId: tableEnd.r,
        columnId: tableEnd.c,
      },
    };
  return offerBefore !== null &&
    offerBefore.endOfTable !== null &&
    isSameCell(offerBefore.firstWithAnError, firstWithAnError) &&
    reads.positionOfCell(offerBefore.endOfTable) !== null
    ? {
        ...offerBefore,
        first,
        last,
      }
    : {
        first,
        last,
        firstWithAnError,
        endOfTable: null,
      };
}
export function updateErrorsOffered(
  offered: ErrorsOffered | null,
  reads: WorkbookReads,
  sheetId: SheetId,
  hasWorkbookChanged: boolean,
  isForced = false,
): ErrorsOffered {
  let errors = errorCellsAround(reads, sheetId);
  let withoutOffer = {
    sheetId,
    sentAwayOn: offered?.sentAwayOn ?? [],
    offer: null,
    isInsertOfRowsAwaited: false,
  };
  if (errors === null)
    return {
      ...withoutOffer,
      count: 1 / 0,
      countWithValues: 1 / 0,
      baseline: 1 / 0,
    };
  let { count, around } = errors;
  if (offered === null || offered.sheetId !== sheetId)
    return {
      ...withoutOffer,
      count,
      countWithValues: count,
      baseline: count,
    };
  let { sentAwayOn, isInsertOfRowsAwaited } = offered;
  let baseline = hasWorkbookChanged ? Math.min(offered.baseline, offered.countWithValues) : offered.baseline;
  let offer =
    (count > baseline || isForced) && around !== null && !isInsertOfRowsAwaited
      ? errorsOffer(reads, sheetId, around, offered.offer, hasWorkbookChanged, isForced)
      : null;
  let countWithValues = reads.calculationTookTooLong ? offered.countWithValues : count;
  return {
    sheetId,
    count,
    countWithValues,
    baseline,
    sentAwayOn,
    offer,
    isInsertOfRowsAwaited,
  };
}
export function errorsOfferShown(state: PageState, reads: WorkbookReads): ErrorsOffer | null {
  let { errorsOffered, sheetId } = state;
  return isErrorsOfferBlocked(state) ||
    errorsOffered?.sheetId !== sheetId ||
    cellExplained(
      {
        ...state,
        isSteppedOutOfCells: false,
      },
      reads,
    ) !== null
    ? null
    : errorsOffered.offer;
}
export function readErrorsAtOpening(state: PageState, reads: WorkbookReads): PageState {
  let isToBeRead = state.errorsFoundAtOpening === 'toBeRead';
  if (isToBeRead ? !areErrorsAtOpeningDue(state) : state.errorsAtOpening === null) return state;
  let errors = errorsAtOpeningOf(reads, state.sheetId);
  if (!isToBeRead)
    return {
      ...state,
      errorsAtOpening: errors,
    };
  let { sheetsWhoseToastIsSpent, sheetId } = state;
  return {
    ...state,
    errorsAtOpening: errors,
    errorsFoundAtOpening: {
      sheetId,
      count: errors?.count ?? 0,
    },
    sheetsWhoseToastIsSpent: errors === null ? sheetsWhoseToastIsSpent : [...sheetsWhoseToastIsSpent, sheetId],
  };
}
export function updateErrorsAtOpening(before: PageState, after: PageState, event: PageEvent): PageState {
  let { sheetsWhoseToastIsSpent, sheetId } = after;
  let isToastSpent = sheetsWhoseToastIsSpent.includes(sheetId);
  if (sheetId !== before.sheetId && !isTakeBackMade(event))
    return {
      ...after,
      errorsAtOpening: null,
      errorsFoundAtOpening: isToastSpent ? null : 'toBeRead',
    };
  if (doesEventSpendErrorsToast(event))
    return {
      ...after,
      errorsAtOpening: null,
      errorsFoundAtOpening: null,
      sheetsWhoseToastIsSpent: isToastSpent ? sheetsWhoseToastIsSpent : [...sheetsWhoseToastIsSpent, sheetId],
    };
  if (after.isAgentWorking === before.isAgentWorking) return after;
  if (!after.isAgentWorking)
    return isToastSpent
      ? after
      : {
          ...after,
          errorsFoundAtOpening: 'toBeRead',
        };
  return after.errorsAtOpening === null
    ? after
    : {
        ...after,
        errorsAtOpening: null,
        errorsFoundAtOpening: 'toBeRead',
        sheetsWhoseToastIsSpent: sheetsWhoseToastIsSpent.filter((spentOn) => spentOn !== sheetId),
      };
}
export const NO_ERROR_COLUMN_IDS: ColumnId[] = [];
export const errorCellsCache = new WeakMap<CellsOfRow, ColumnId[]>();
export const MAX_ERROR_CELLS = 2000;
export const ASK_AGENT_TO_FIX_LABEL = 'Ask Agent to fix';
export const withoutStaleOffer = (offered: ErrorsOffered | null): ErrorsOffered | null =>
  offered === null || offered.count > offered.baseline
    ? offered
    : {
        ...offered,
        offer: null,
      };
export const withBaselineRaised = (offered: ErrorsOffered): ErrorsOffered => ({
  ...offered,
  baseline: Math.max(offered.count, offered.countWithValues),
  offer: null,
});
export const putAwayErrorsOffer = (offered: ErrorsOffered): ErrorsOffered => ({
  ...withBaselineRaised(offered),
  sentAwayOn: offered.sentAwayOn.includes(offered.sheetId) ? offered.sentAwayOn : [...offered.sentAwayOn, offered.sheetId],
});
export const resetBaselineOfOffer = (offered: ErrorsOffered | null): ErrorsOffered | null =>
  offered === null || offered.sentAwayOn.includes(offered.sheetId)
    ? offered
    : {
        ...offered,
        baseline: 0,
      };
export const awaitInsertOfRows = (offered: ErrorsOffered): ErrorsOffered =>
  offered.offer === null
    ? {
        ...offered,
        isInsertOfRowsAwaited: true,
      }
    : offered;
export const endAwaitInsertOfRows = (offered: ErrorsOffered): ErrorsOffered =>
  offered.isInsertOfRowsAwaited
    ? {
        ...withBaselineRaised(offered),
        isInsertOfRowsAwaited: false,
      }
    : offered;
export const isErrorsOfferBlocked = (state: PageState): boolean =>
  state.mode.kind === 'editing' || state.isAgentWorking || state.doesCommentModePickCells || cellOfFixNotice(state) !== null;
export const areErrorsAtOpeningDue = (state: PageState): boolean => state.errorsFoundAtOpening === 'toBeRead' && !state.isAgentWorking;
export const isTakeBackMade = (event: PageEvent): boolean =>
  (event.kind === 'takeBackAnswered' && event.outcome.kind === 'made') || (event.kind === 'undoOrRedoAnswered' && event.outcome.kind === 'made');
export const doesEventSpendErrorsToast = (event: PageEvent): boolean =>
  (event.kind === 'editAnswered' && event.outcome.kind === 'editQueued') ||
  isTakeBackMade(event) ||
  event.kind === 'errorsOfferPutAway' ||
  event.kind === 'fixesInPlaceAsked';
