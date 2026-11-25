import { areaOfReference } from '../model/reference-areas.ts';
import { mightFormulaSpill } from './agent-answer-checks.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { Reference, SheetId } from '@open-artifact/sheets-core';
/** The cells of a sheet that hang on the formulas followed: by column, the rows they are in, and those a formula could spill from. */
export interface CellsHangingInSheet {
  rowsByColumn: Map<number, Set<number>>;
  filled: CellPosition[];
}
export type CellsHangingBySheet = Map<SheetId, CellsHangingInSheet>;
/** How many more steps a search of hanging cells may take; it goes below zero once they are spent. */
export interface StepsBudget {
  stepsLeft: number;
}
/** An area a formula reads, with its sheet. */
interface AreaRead {
  sheetId: SheetId;
  area: CellArea;
}
/** A formula still to be found hanging or not: its cell, whether it could spill, and the areas it reads. */
interface FormulaToFollow {
  sheetId: SheetId;
  at: CellPosition;
  couldFill: boolean;
  read: AreaRead[];
}
export function areaTouchesHangingCells(
  hangingBySheet: CellsHangingBySheet,
  sheetId: SheetId,
  { topRowIndex: topRow, leftColumnIndex: leftColumn, rowCount, columnCount }: CellArea,
  budget: StepsBudget = {
    stepsLeft: 1 / 0,
  },
): boolean {
  let hangingInSheet = hangingBySheet.get(sheetId);
  if (hangingInSheet === undefined) return false;
  let { filled, rowsByColumn } = hangingInSheet;
  let [bottomRow, rightColumn] = [topRow + rowCount - 1, leftColumn + columnCount - 1];
  budget.stepsLeft -= filled.length + Math.min(columnCount, rowsByColumn.size);
  if (filled.some((position) => position.rowIndex <= bottomRow && position.columnIndex <= rightColumn)) return true;
  let hasRowInArea = (rows: Set<number>) => {
    if (rows.size <= rowCount) {
      for (let rowIndex of rows) if (((budget.stepsLeft -= 1), rowIndex >= topRow && rowIndex <= bottomRow)) return true;
      return false;
    }
    for (let rowIndex = topRow; rowIndex <= bottomRow; rowIndex += 1) if (((budget.stepsLeft -= 1), rows.has(rowIndex))) return true;
    return false;
  };
  if (columnCount <= rowsByColumn.size) {
    for (let columnIndex = leftColumn; columnIndex <= rightColumn; columnIndex += 1) {
      let rows = rowsByColumn.get(columnIndex);
      if (rows !== undefined && hasRowInArea(rows)) return true;
    }
    return false;
  }
  for (let [columnIndex, rows] of rowsByColumn)
    if (columnIndex >= leftColumn && columnIndex <= rightColumn && hasRowInArea(rows)) return true;
  return false;
}
export function areaOfReferenceOrSheet(reads: WorkbookReads, reference: Reference): CellArea | null {
  let area = areaOfReference(reads, reference);
  if (area !== null || reference.kind === 'cell') return area;
  let sheet = reads.listSheets().find(({ sheetId }) => sheetId === reference.sheetId);
  return sheet === undefined
    ? null
    : {
        topRowIndex: 0,
        leftColumnIndex: 0,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
      };
}
export function findCellsHangingOn(
  reads: WorkbookReads,
  startCells: Iterable<CellId>,
  maxSteps: number = MAX_DEPENDENT_STEPS,
): CellsHangingBySheet | null {
  let hangingBySheet: CellsHangingBySheet = new Map();
  let markHanging = (sheetId: SheetId, position: CellPosition, couldFill: boolean) => {
    let hanging: CellsHangingInSheet = hangingBySheet.get(sheetId) ?? {
      rowsByColumn: new Map(),
      filled: [],
    };
    hangingBySheet.set(sheetId, hanging);
    let rows = hanging.rowsByColumn.get(position.columnIndex) ?? new Set<number>();
    hanging.rowsByColumn.set(position.columnIndex, rows);
    rows.add(position.rowIndex);
    if (couldFill) hanging.filled.push(position);
  };
  for (let cellId of startCells) {
    let position = reads.positionOfCell(cellId);
    let formulaText = reads.cellOf(cellId)?.formulaText ?? '';
    if (position !== null) markHanging(cellId.sheetId, position, mightFormulaSpill(formulaText, reads.decimalSign));
  }
  let formulas: FormulaToFollow[] = [];
  for (let { sheetId } of reads.listSheets())
    for (let [rowId, cells] of reads.cellsHeldByRow(sheetId))
      for (let [columnId, { input, formulaText = '' }] of cells) {
        let position =
          input.kind === 'formula'
            ? reads.positionOfCell({
                sheetId,
                rowId,
                columnId,
              })
            : null;
        if (input.kind !== 'formula' || position === null) continue;
        let readAreas = input.formula.references.flatMap((reference): AreaRead[] => {
          let area = areaOfReferenceOrSheet(reads, reference);
          return area === null
            ? []
            : [
                {
                  sheetId: reference.sheetId,
                  area,
                },
              ];
        });
        let couldFill = mightFormulaSpill(formulaText, reads.decimalSign);
        if (readAreas.length > 0 || couldFill)
          formulas.push({
            sheetId,
            at: position,
            couldFill,
            read: readAreas,
          });
      }
  formulas.sort(
    ({ at }, { at: otherAt }) =>
      at.rowIndex === otherAt.rowIndex ? at.columnIndex - otherAt.columnIndex : at.rowIndex - otherAt.rowIndex,
  );
  let budget: StepsBudget = {
    stepsLeft: maxSteps,
  };
  while (budget.stepsLeft >= 0) {
    let stillToFollow = formulas.filter(({ sheetId, at, couldFill, read }) => {
      budget.stepsLeft -= 1;
      if (budget.stepsLeft < 0) return true;
      let isHanging =
        (couldFill && (hangingBySheet.get(sheetId)?.filled.length ?? 0) > 0) ||
        read.some((areaRead) => areaTouchesHangingCells(hangingBySheet, areaRead.sheetId, areaRead.area, budget));
      if (isHanging) markHanging(sheetId, at, couldFill);
      return !isHanging;
    });
    if (stillToFollow.length === formulas.length && budget.stepsLeft >= 0) return hangingBySheet;
    stillToFollow.reverse();
    formulas = stillToFollow;
  }
  return null;
}
export function cellsHangingOnFormulasWhere(
  reads: WorkbookReads,
  isWanted: (formulaText: string) => boolean,
): CellsHangingBySheet | null {
  let startCells: CellId[] = [];
  for (let { sheetId } of reads.listSheets())
    for (let [rowId, cellsByColumn] of reads.cellsHeldByRow(sheetId))
      for (let [columnId, { formulaText }] of cellsByColumn)
        if (formulaText !== undefined && isWanted(formulaText))
          startCells.push({
            sheetId,
            rowId,
            columnId,
          });
  return startCells.length === 0 ? new Map<SheetId, CellsHangingInSheet>() : findCellsHangingOn(reads, startCells);
}
export const MAX_DEPENDENT_STEPS = 20000000;
