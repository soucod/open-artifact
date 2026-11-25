import type { ColumnPoint, DecimalSignName, ErrorValue, Reference, RowPoint, SheetId } from '@open-artifact/sheets-core';
import { findFormulaReferences } from '../references.ts';
import { errorCellsOfSheet, isErrorsOfferBlocked, errorsOfferShown } from './errors-offer.ts';
import type { ErrorCell } from './errors-offer.ts';
import { errorCodeOfCell, cellKeyOf } from '../error-tells.ts';
import { areaOfReference } from '../../model/reference-areas.ts';
import { ownRowOrderOfSheet } from '../../model/line-ids.ts';
import { formulaLostToLastAct, fixableErrorAt } from './ask.ts';
import { rowNumberAsStored } from '../../model/a1-references.ts';
import { isLineShown } from '../../model/line-sizes.ts';
import type { LineSizes } from '../../model/line-sizes.ts';
import { layoutOfView } from '../../grid/layout.ts';
import { isSameCell, selectedArea } from '../../selection/model.ts';
import type { CellArea, CellPosition } from '../../selection/model.ts';
import { isSelectionOneCell } from '../../selection/keyboard.ts';
import { keepIfSameJson } from '../../state/explained-under-cell.ts';
import type { FixesOnCells, FixesToOffer, FixToOffer, LostFormula, PageState } from '../../state/initial-state.ts';
import type { PageEffect } from '../../state/transitions.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../../state/controller.ts';
/** What telling whether an error cell is a copy of the one above it reads: the page, the workbook and the rows in view. */
export interface CopyCheckContext {
  state: PageState;
  reads: WorkbookReads;
  rowEdges: LineSizes;
}
export function shiftFormulaRows(formula: string, rowShift: number, decimalSign: DecimalSignName): string | null {
  let shifted = '';
  let lastEnd = 0;
  for (let { ends } of findFormulaReferences(formula, decimalSign).references)
    for (let { start, end, dollarOfColumn, letters, dollarOfRow, digits } of ends) {
      let rowNumber = digits === '' || dollarOfRow !== '' ? digits : Number(digits) + rowShift;
      if (typeof rowNumber === 'number' && rowNumber < 1) return null;
      shifted += `${formula.slice(lastEnd, start)}${dollarOfColumn}${letters}${dollarOfRow}${rowNumber}`;
      lastEnd = end;
    }
  return shifted + formula.slice(lastEnd);
}
export function relativeReferenceParts(reads: WorkbookReads, reference: Reference, origin: CellPosition): (string | number)[] {
  let { sheetId } = reference;
  let rowPart = (point: RowPoint | null) => {
    if (point === null) return '';
    let rowIndex = reads.rowIndexOf(sheetId, point.r);
    if (point.isRowAbsolute) return `$${point.r}`;
    return rowIndex === null ? Number.NaN : rowIndex - origin.rowIndex;
  };
  let columnPart = (point: ColumnPoint | null) => {
    if (point === null) return '';
    let columnIndex = reads.columnIndexOf(sheetId, point.c);
    if (point.isColumnAbsolute) return `$${point.c}`;
    return columnIndex === null ? point.c : columnIndex - origin.columnIndex;
  };
  switch (reference.kind) {
    case 'cell':
      return [rowPart(reference.cell), columnPart(reference.cell)];
    case 'range':
      return [rowPart(reference.topLeft), columnPart(reference.topLeft), rowPart(reference.bottomRight), columnPart(reference.bottomRight)];
    case 'columns':
      return [columnPart(reference.left), columnPart(reference.right), rowPart(reference.top)];
    case 'rows':
      return [rowPart(reference.top), rowPart(reference.bottom), columnPart(reference.left)];
  }
}
export function areFormulasCopies(reads: WorkbookReads, cellId: CellId, otherCellId: CellId): boolean {
  let stored = reads.asStored() ?? reads;
  let [input, otherInput] = [stored.cellOf(cellId)?.input, stored.cellOf(otherCellId)?.input];
  let [position, otherPosition] = [stored.positionOfCell(cellId), stored.positionOfCell(otherCellId)];
  if (input?.kind !== 'formula' || otherInput?.kind !== 'formula') return false;
  if (position === null || otherPosition === null) return false;
  let [formula, otherFormula] = [input.formula, otherInput.formula];
  return (
    formula.textBetweenReferences.length === otherFormula.textBetweenReferences.length &&
    formula.textBetweenReferences.every(
      (textBetweenReference, index) => textBetweenReference === otherFormula.textBetweenReferences[index],
    ) &&
    formula.references.every((reference, index) => {
      let otherReference = otherFormula.references[index];
      if (otherReference?.kind !== reference.kind || otherReference.sheetId !== reference.sheetId) return false;
      let otherParts = relativeReferenceParts(stored, otherReference, otherPosition);
      return relativeReferenceParts(stored, reference, position).every((part, partIndex) => part === otherParts[partIndex]);
    })
  );
}
/** Whether any of the sorted row indexes falls within the rows of the area. */
export function hasRowInRange(area: CellArea, rowIndexes: number[]): boolean {
  let [low, high] = [0, rowIndexes.length];
  while (low < high) {
    let middle = (low + high) >> 1;
    if ((rowIndexes[middle] ?? 0) < area.topRowIndex) low = middle + 1;
    else high = middle;
  }
  let firstAtOrBelowTop = rowIndexes[low];
  return firstAtOrBelowTop !== undefined && firstAtOrBelowTop < area.topRowIndex + area.rowCount;
}
/** The error cells of a sheet whose formulas read no cell showing the same error: where the errors start. */
export function rootErrorCells(reads: WorkbookReads, sheetId: SheetId): ErrorCell[] | null {
  let bySheet = rootErrorCellsCache.get(reads) ?? new Map<SheetId, ErrorCell[] | null>();
  rootErrorCellsCache.set(reads, bySheet);
  let entry = bySheet.get(sheetId);
  if (entry !== undefined) return entry;
  let errorCells = errorCellsOfSheet(reads, sheetId) ?? [];
  let rowsByColumnByError = new Map<ErrorValue | null, Map<number, number[]>>();
  let errorCodeAt = (cellId: CellId) => errorCodeOfCell(reads.cellOnShowIn(cellId));
  for (let { cellId, position } of errorCells) {
    let rowsByColumn = rowsByColumnByError.get(errorCodeAt(cellId)) ?? new Map<number, number[]>();
    rowsByColumnByError.set(errorCodeAt(cellId), rowsByColumn);
    let rowIndexes = rowsByColumn.get(position.columnIndex) ?? [];
    rowsByColumn.set(position.columnIndex, rowIndexes);
    rowIndexes.push(position.rowIndex);
  }
  for (let rowsByColumn of rowsByColumnByError.values())
    for (let rowIndexes of rowsByColumn.values()) rowIndexes.sort((rowIndex, otherRowIndex) => rowIndex - otherRowIndex);
  let rootCells: ErrorCell[] = [];
  for (let errorCell of errorCells) {
    let { cellId } = errorCell;
    let input = reads.cellOf(cellId)?.input;
    let rowsByColumn = rowsByColumnByError.get(errorCodeAt(cellId)) ?? new Map<number, number[]>();
    if (
      !(input?.kind === 'formula' ? input.formula.references : []).some((reference) => {
        let area = reference.sheetId === sheetId ? areaOfReference(reads, reference) : null;
        if (area === null) return false;
        return [...rowsByColumn].some(
          ([columnIndex, rowIndexes]) =>
            columnIndex >= area.leftColumnIndex && columnIndex < area.leftColumnIndex + area.columnCount && hasRowInRange(area, rowIndexes),
        );
      })
    )
      rootCells.push(errorCell);
    if (rootCells.length > MAX_ROOT_ERROR_CELLS) break;
  }
  rootCells.sort(
    ({ position }, { position: otherPosition }) =>
      position.columnIndex === otherPosition.columnIndex ? position.rowIndex - otherPosition.rowIndex : position.columnIndex - otherPosition.columnIndex,
  );
  let found = rootCells.length === 0 || rootCells.length > MAX_ROOT_ERROR_CELLS ? null : rootCells;
  bySheet.set(sheetId, found);
  return found;
}
export function isCellFixable(state: PageState, reads: WorkbookReads, cellId: CellId): boolean {
  let formulasLostToLastAct = state.formulasLostToLastAct;
  return (
    (formulasLostToLastAct !== null &&
      formulasLostToLastAct.atChangeCount === state.workbookChangeCount &&
      formulasLostToLastAct.byCell.has(cellKeyOf(cellId))) ||
    FIXABLE_ERROR_CODES.has(errorCodeOfCell(reads.cellOnShowIn(cellId)))
  );
}
export function isFormulaCopyBelow(upper: LostFormula, lower: LostFormula, decimalSign: DecimalSignName): boolean {
  let rowShift = Number(TRAILING_DIGITS.exec(lower.cell)?.[0]) - Number(TRAILING_DIGITS.exec(upper.cell)?.[0]);
  return (
    Number.isInteger(rowShift) &&
    upper.cell.replace(TRAILING_DIGITS, '') === lower.cell.replace(TRAILING_DIGITS, '') &&
    shiftFormulaRows(upper.text, rowShift, decimalSign) === lower.text
  );
}
export function isCopyOfCellAbove({ state, reads, rowEdges }: CopyCheckContext, upper: ErrorCell, lower: ErrorCell): boolean {
  let ownRowOrder = ownRowOrderOfSheet(reads, state.sheetId);
  let [upperFormula, lowerFormula] = [upper, lower].map(({ cellId }) => formulaLostToLastAct(state, cellId));
  return (
    lower.position.columnIndex === upper.position.columnIndex &&
    lower.position.rowIndex === upper.position.rowIndex + 1 &&
    rowNumberAsStored(lower.position.rowIndex, ownRowOrder) === rowNumberAsStored(upper.position.rowIndex, ownRowOrder) + 1 &&
    isLineShown(rowEdges, lower.position.rowIndex) &&
    reads.mergedAreaAt(state.sheetId, upper.position) === null &&
    reads.mergedAreaAt(state.sheetId, lower.position) === null &&
    errorCodeOfCell(reads.cellOnShowIn(lower.cellId)) === errorCodeOfCell(reads.cellOnShowIn(upper.cellId)) &&
    (upperFormula === undefined || lowerFormula === undefined
      ? upperFormula === lowerFormula && reads.cellOf(upper.cellId)?.formulaText?.includes('#REF!') !== true
      : isFormulaCopyBelow(upperFormula, lowerFormula, reads.decimalSign)) &&
    areFormulasCopies(reads, upper.cellId, lower.cellId)
  );
}
/** The fixes to offer for the errors in view, within the area when one is given. */
export function fixesToOffer(state: PageState, reads: ReadsWithTextMeasurer, within: CellArea | null): FixesToOffer {
  if (state.fixesOnCells.cameToNothingAt === state.workbookChangeCount) return null;
  let rootCells = (rootErrorCells(reads, state.sheetId) ?? []).filter(
    ({ position }) => within === null || isPositionInGridArea(within, position),
  );
  if (rootCells.length === 0) return null;
  let { rowEdges, columnEdges } = layoutOfView(state, reads);
  let inView = rootCells.filter(
    ({ cellId, position }) =>
      isCellFixable(state, reads, cellId) &&
      isLineShown(rowEdges, position.rowIndex) &&
      isLineShown(columnEdges, position.columnIndex) &&
      reads.formatOf(cellId).cellControl.kind === 'none',
  );
  let groups: ErrorCell[][] = [];
  let copyContext = {
    state,
    reads,
    rowEdges,
  };
  for (let errorCell of inView) {
    let cellAbove = groups.at(-1)?.at(-1);
    if (cellAbove !== undefined && isCopyOfCellAbove(copyContext, cellAbove, errorCell)) groups.at(-1)?.push(errorCell);
    else groups.push([errorCell]);
  }
  if (groups.length > MAX_FIX_GROUPS) return null;
  let toOffer: FixToOffer[] = [];
  let isAnyYetToBeKnown = false;
  for (let [first, ...copies] of groups) {
    let fixable = first === undefined ? null : fixableErrorAt(state, reads, first.cellId);
    if (fixable === null || first === undefined) continue;
    if (fixable === 'yetToBeKnown') isAnyYetToBeKnown = true;
    else if (isSameCell(fixable.origin, first.cellId))
      toOffer.push({
        ...fixable,
        copies: copies.map(({ cellId }) => cellId),
      });
  }
  if (isAnyYetToBeKnown) return 'yetToBeKnown';
  return toOffer.length === 0 ? null : toOffer;
}
export function fixesToOfferInSelection(state: PageState, reads: ReadsWithTextMeasurer): FixesToOffer {
  if (state.otherRanges.length > 0 || isSelectionOneCell(state, reads)) return null;
  if (isErrorsOfferBlocked(state) || state.errorsOffered?.sheetId !== state.sheetId) return null;
  let area = selectedArea(state, reads);
  return area === null ? null : fixesToOffer(state, reads, area);
}
export function updateFixesToOffer(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let { toOffer: toOfferBefore, toOfferInSelection: inSelectionBefore, stage } = state.fixesOnCells;
  if (stage !== null) return state;
  let toOffer = keepIfSameJson(fixesToOfferOnSheet(state, reads), toOfferBefore);
  let inSelection = keepIfSameJson(state.menu === null ? null : fixesToOfferInSelection(state, reads), inSelectionBefore);
  return toOffer === toOfferBefore && inSelection === inSelectionBefore
    ? state
    : withFixesOnCells(state, {
        toOffer,
        toOfferInSelection: inSelection,
      });
}
export const NO_FIXES_ON_CELLS: FixesOnCells = {
  toOffer: null,
  toOfferInSelection: null,
  stage: null,
  cameToNothingAt: null,
  askCount: 0,
  isEndToldDuringAct: false,
  offerDueBackOn: [],
};
export const MAX_FIX_GROUPS = 5;
export const MAX_ROOT_ERROR_CELLS = 200;
export const STOP_FIX_ASKS_EFFECTS: PageEffect[] = [
  {
    kind: 'stopAskingAgentForFixes',
  },
];
export const withFixesOnCells = (state: PageState, changes: Partial<FixesOnCells>): PageState => ({
  ...state,
  fixesOnCells: {
    ...state.fixesOnCells,
    ...changes,
  },
});
export const isPositionInGridArea = (area: CellArea, { rowIndex, columnIndex }: CellPosition): boolean =>
  rowIndex >= area.topRowIndex &&
  rowIndex < area.topRowIndex + area.rowCount &&
  columnIndex >= area.leftColumnIndex &&
  columnIndex < area.leftColumnIndex + area.columnCount;
export const rootErrorCellsCache = new WeakMap<WorkbookReads, Map<SheetId, ErrorCell[] | null>>();
export const FIXABLE_ERROR_CODES = new Set<ErrorValue | null>(['#NAME?', '#ERROR!']);
export const TRAILING_DIGITS = /\d+$/;
export const fixesToOfferOnSheet = (state: PageState, reads: ReadsWithTextMeasurer): FixesToOffer =>
  errorsOfferShown(state, reads) === null && state.errorsAtOpening === null ? null : fixesToOffer(state, reads, null);
