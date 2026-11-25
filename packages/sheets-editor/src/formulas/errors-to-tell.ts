import type { SheetId } from '@open-artifact/sheets-core';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { CellId } from '../model/workbook.ts';
import { areaToA1AsStored } from './from-words/where.ts';
import { rootErrorCells } from './fix/cells-to-fix.ts';
import { cellKeyOf, explainCellError } from './error-tells.ts';
import { errorCellsOfSheet, errorsOfferShown } from './fix/errors-offer.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { fixesBarStage, fixesInSelectionStage } from './fix/fixes-on-cells.ts';
import { selectedArea } from '../selection/model.ts';
import type { ErrorExplained, PageState } from '../state/initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
/** The cells in error to explain, those whose errors come first listed first; and how many more there are (`null`: too many to count). */
export interface ErrorCellsToExplain {
  cells: CellId[];
  leftOut: number | null;
}
/** A cell in error, by its address, and why it shows the error. */
export interface ErrorToTell {
  cell: string;
  reason: ErrorExplained;
}
export interface ErrorsToTellOfSelection {
  errors: ErrorToTell[];
  leftOut: number;
}
export function errorCellsToExplain(reads: WorkbookReads, sheetId: SheetId, area: CellArea | null): ErrorCellsToExplain {
  let cacheOfReads = explainedErrorCellsCache.get(reads) ?? new Map<string, ErrorCellsToExplain>();
  explainedErrorCellsCache.set(reads, cacheOfReads);
  let cacheKey = `${sheetId}/${area === null ? '' : areaToA1AsStored(area, null)}`;
  let cached = cacheOfReads.get(cacheKey);
  if (cached !== undefined) return cached;
  let cellsInErrorFirst = new Set<string>(
    (rootErrorCells(reads, sheetId) ?? []).map((rootCell: { cellId: CellId }) => cellKeyOf(rootCell.cellId)),
  );
  let errorCells = errorCellsOfSheet(reads, sheetId);
  let errorsInArea = (errorCells ?? []).filter(
    ({ position }) => area === null || isPositionInsideArea(area, position),
  );
  errorsInArea.sort((first, second) => {
    let [isFirstListed, isSecondListed] = [first, second].map(
      ({ cellId }) => cellsInErrorFirst.has(cellKeyOf(cellId)),
    );
    if (isFirstListed !== isSecondListed) return isFirstListed === true ? -1 : 1;
    return first.position.rowIndex === second.position.rowIndex
      ? first.position.columnIndex - second.position.columnIndex
      : first.position.rowIndex - second.position.rowIndex;
  });
  let found: ErrorCellsToExplain = {
    cells: errorsInArea.slice(0, MAX_ERROR_CELLS_EXPLAINED).map(({ cellId }) => cellId),
    leftOut: errorCells === null ? null : Math.max(0, errorsInArea.length - MAX_ERROR_CELLS_EXPLAINED),
  };
  cacheOfReads.set(cacheKey, found);
  return found;
}
export function errorsToTellOfSelection(
  reads: WorkbookReads,
  sheetId: SheetId,
  area: CellArea,
  activeCellId: CellId,
): ErrorsToTellOfSelection | null {
  let { cells, leftOut } = errorCellsToExplain(reads, sheetId, area);
  if (leftOut === null && area.rowCount * area.columnCount > 1) return null;
  let errors = (cells.length === 0 ? [activeCellId] : cells).flatMap((cellId): ErrorToTell[] => {
    let [reason, position] = [explainCellError(reads, cellId), reads.positionOfCell(cellId)];
    if (reason === null || position === null || reason.code === '#TIMEOUT!') return [];
    return [
      {
        cell: areaToA1AsStored(
          {
            topRowIndex: position.rowIndex,
            leftColumnIndex: position.columnIndex,
            rowCount: 1,
            columnCount: 1,
          },
          ownRowOrderOfSheet(reads, sheetId),
        ),
        reason,
      },
    ];
  });
  return errors.length === 0
    ? null
    : {
        errors,
        leftOut: leftOut ?? 0,
      };
}
/** Explains the errors the page is about to show, so that the reasons are asked for before they are shown. */
export function explainErrorCellsAhead(state: PageState, reads: WorkbookReads): void {
  let isSheetErrorsShown = fixesBarStage(state) === null && (errorsOfferShown(state, reads) !== null || state.errorsAtOpening !== null);
  let areaOfSelection = state.menu !== null && fixesInSelectionStage(state) === null ? selectedArea(state, reads) : null;
  let cellIds = [
    ...(isSheetErrorsShown ? errorCellsToExplain(reads, state.sheetId, null).cells : []),
    ...(areaOfSelection === null ? [] : errorCellsToExplain(reads, state.sheetId, areaOfSelection).cells),
  ];
  for (let cellId of cellIds) explainCellError(reads, cellId);
}
export const MAX_ERROR_CELLS_EXPLAINED = 8;
export const explainedErrorCellsCache = new WeakMap<WorkbookReads, Map<string, ErrorCellsToExplain>>();
export const isPositionInsideArea = (area: CellArea, { rowIndex, columnIndex }: CellPosition): boolean =>
  rowIndex >= area.topRowIndex &&
  rowIndex < area.topRowIndex + area.rowCount &&
  columnIndex >= area.leftColumnIndex &&
  columnIndex < area.leftColumnIndex + area.columnCount;
