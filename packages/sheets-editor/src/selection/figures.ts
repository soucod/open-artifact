import type { CellControl, NumberFormatKind, SheetId, ValueContents } from '@open-artifact/sheets-core';
import type { CellId, SignsOfNumbers, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea, CellPosition, SelectionKind } from './model.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { numberFormatOfCell, isFormulaCell } from '../model/workbook.ts';
import { isGeneralPattern } from '../model/cell-format.ts';
import { roundToShownPrecision } from '../format/general-numbers.ts';
import { isCheckboxFormat, booleanOfValue } from '../chips/checkboxes.ts';
import { readsOverShownRows } from '../tables/filtered-rows.ts';
import { hasOtherRanges, areasOfAllRanges } from './several-ranges.ts';
import { selectedArea, mergedAreaOrCellOf, isSameArea, selectionKindOf, selectionAtCell, areaOfPosition } from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { withNoEffects } from '../state/transitions.ts';
import { wholeAreaToA1AsStored } from '../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { queueEdit, enterTextEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A cell that holds a value, with what its format says of it. */
export interface ValuedCell extends CellPosition {
  value: ValueContents;
  numberFormatKind: NumberFormatKind | null;
  hasNumberFormat: boolean;
  cellControl: CellControl;
}
/** The sum, average, least, most and count of some numbers. */
export interface SumFigures {
  sum: number;
  average: number;
  min: number;
  max: number;
  count: number;
}
/** The cells of a column of numbers, and the heading over it. */
export interface NumbersUnderHeading {
  cells: ValuedCell[];
  heading: string | null;
}
/** The figures of numbers selected, with the cell a formula of them could go in. */
export interface SumFigure extends SumFigures {
  kind: 'sum';
  signsOfNumbers: SignsOfNumbers;
  heading: string | null;
  area: CellArea;
  formulaCell: CellId | null;
}
/** What the selected cells come to, told under the grid. */
export type FigureOfCells =
  | { kind: 'errors'; count: number }
  | { kind: 'duplicates'; count: number }
  | { kind: 'checked'; count: number; checkboxCount: number }
  | { kind: 'empty'; count: number }
  | SumFigure;
export function nonEmptyValueOfCell(reads: WorkbookReads, cellId: CellId | null): ValueContents | null {
  let value = cellId === null ? null : cellValueOf(reads.cellOnShowIn(cellId));
  return value?.value === '' ? null : value;
}
export function valuedCellsIn(reads: WorkbookReads, sheetId: SheetId, area: CellArea): ValuedCell[] {
  let cells: ValuedCell[] = [];
  for (let rowOffset = 0; rowOffset < area.rowCount; rowOffset += 1)
    for (let columnOffset = 0; columnOffset < area.columnCount; columnOffset += 1) {
      let [rowIndex, columnIndex] = [area.topRowIndex + rowOffset, area.leftColumnIndex + columnOffset];
      let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
      let value = nonEmptyValueOfCell(reads, cellId);
      if (cellId === null || value === null) continue;
      let { cellControl } = reads.formatOf(cellId);
      let numberFormat = value.kind === 'number' ? numberFormatOfCell(reads, cellId) : null;
      cells.push({
        rowIndex,
        columnIndex,
        value,
        numberFormatKind: numberFormat?.kind ?? null,
        hasNumberFormat: numberFormat !== null && !isGeneralPattern(numberFormat.pattern),
        cellControl,
      });
    }
  return cells;
}
export function decimalPlacesOf(number: number): number {
  let [mantissa = '', exponent = '0'] = String(Number(number.toPrecision(15))).split('e');
  return Math.max(0, (mantissa.split('.')[1] ?? '').length - Number(exponent));
}
export function isWholeAtDecimals(number: number, decimals: number): boolean {
  let scaled = number * 10 ** decimals;
  return Math.abs(scaled - Math.round(scaled)) <= Math.abs(scaled) * Number.EPSILON;
}
export function sumFigures(numbers: readonly number[], isRounded: boolean): SumFigures | null {
  let [sum, compensation, decimals] = [0, 0, 0];
  let [min, max] = [1 / 0, -1 / 0];
  for (let number of numbers) {
    let nextSum = sum + number;
    compensation += Math.abs(sum) >= Math.abs(number) ? sum - nextSum + number : number - nextSum + sum;
    sum = nextSum;
    min = Math.min(min, number);
    max = Math.max(max, number);
    if (!isWholeAtDecimals(number, decimals)) decimals = Math.max(decimals, decimalPlacesOf(number));
  }
  let total = sum + compensation;
  if (!(Math.abs(total) < 1000000000000000)) return null;
  let shown: (number: number) => number = isRounded ? roundToShownPrecision : (number: number) => number;
  return {
    sum: shown(roundToDecimals(total, decimals)),
    average: shown(roundToDecimals(total / numbers.length, decimals + 2)),
    min: shown(min),
    max: shown(max),
    count: numbers.length,
  };
}
export function cellForSumBelow(reads: WorkbookReads, sheetId: SheetId, area: CellArea, selectionArea: CellArea): CellId | null {
  let below = {
    rowIndex: area.topRowIndex + area.rowCount,
    columnIndex: area.leftColumnIndex,
  };
  let cellId = reads.cellIdAt(sheetId, below.rowIndex, below.columnIndex);
  let isFree = cellId !== null && reads.cellOf(cellId) === null && !isFormulaCell(reads, cellId);
  if (area.columnCount > 1 || !isFree) return null;
  let isInSelection = below.rowIndex < selectionArea.topRowIndex + selectionArea.rowCount;
  let belowRow = {
    ...selectionArea,
    topRowIndex: below.rowIndex,
    rowCount: 1,
  };
  if (isInSelection && valuedCellsIn(reads, sheetId, belowRow).length > 0) return null;
  let merged = reads.mergedAreaAt(sheetId, below);
  let isMergeStart = merged?.topRowIndex === below.rowIndex && merged.leftColumnIndex === below.columnIndex;
  return merged === null || isMergeStart ? cellId : null;
}
export function duplicatesFigure(cells: readonly ValuedCell[]): FigureOfCells | null {
  let distinctCount = new Set(cells.map(({ value }) => value.value)).size;
  return distinctCount === cells.length || distinctCount <= cells.length / 2
    ? null
    : {
        kind: 'duplicates',
        count: cells.length - distinctCount,
      };
}
export function checkedFigure(cells: readonly ValuedCell[]): FigureOfCells | null {
  let booleans: boolean[] = cells.flatMap((cell) => (isCheckboxFormat(cell) ? (booleanOfValue(cell.value) ?? []) : []));
  return booleans.length < 2 || booleans.length < cells.length
    ? null
    : {
        kind: 'checked',
        count: booleans.filter(Boolean).length,
        checkboxCount: booleans.length,
      };
}
export function isRunningSequence(cells: readonly ValuedCell[]): boolean {
  let numbers = plainNumbersOf(cells);
  return (
    looksLikeYearColumn(cells) ||
    (numbers.length > 1 &&
      numbers.every(Number.isInteger) &&
      numbers.every((number, index) => index === 0 || number === (numbers[index - 1] ?? 0) + 1))
  );
}
export function numberColumnWithHeading(cells: ValuedCell[], headings: readonly ValuedCell[]): NumbersUnderHeading | null {
  let byColumn = new Map<number, ValuedCell[]>();
  for (let cell of cells) {
    let columnCells = byColumn.get(cell.columnIndex);
    if (columnCells === undefined) byColumn.set(cell.columnIndex, [cell]);
    else columnCells.push(cell);
  }
  let numberColumns = [...byColumn.values()].filter(
    (columnCells) => plainNumbersOf(columnCells).length === columnCells.length && !isRunningSequence(columnCells),
  );
  if (numberColumns.length === byColumn.size)
    return {
      cells,
      heading: null,
    };
  let [column] = numberColumns;
  if (numberColumns.length !== 1 || column === undefined || column.length === 1) return null;
  let heading = headings.find(({ columnIndex }) => columnIndex === column[0]?.columnIndex)?.value.value;
  if (typeof heading === 'string' && heading.trim() !== '')
    return {
      cells: column,
      heading: heading.trim(),
    };
  return column.length < plainNumbersOf(cells).length
    ? null
    : {
        cells: column,
        heading: null,
      };
}
export function figuresOfArea(reads: WorkbookReads, sheetId: SheetId, area: CellArea, selectionKind: SelectionKind): FigureOfCells | null {
  let cellCount = area.rowCount * area.columnCount;
  if (cellCount > MAX_FIGURE_CELLS) return null;
  let cells = valuedCellsIn(reads, sheetId, area);
  let errorCount = cells.filter(({ value }) => value.kind === 'error').length;
  if (errorCount > 0)
    return {
      kind: 'errors',
      count: errorCount,
    };
  if (cells.length === 0 || selectionKind === 'rows') return null;
  let topRow = cells.filter(({ rowIndex }) => rowIndex === area.topRowIndex);
  let headings = topRow.length < cells.length && topRow.every(isTextOrDate) ? topRow : [];
  let body = cells.slice(headings.length);
  let checked = checkedFigure(body);
  if (checked !== null) return checked;
  let sumFigure = ({ cells: columnCells, heading }: NumbersUnderHeading): SumFigure | null => {
    let figures = figuresOfCells(columnCells);
    if (figures === null) return null;
    let rowIndexes = columnCells.map(({ rowIndex }) => rowIndex);
    let columnIndexes = columnCells.map(({ columnIndex }) => columnIndex);
    let [topRowIndex, leftColumnIndex] = [Math.min(...rowIndexes), Math.min(...columnIndexes)];
    let figureArea = {
      topRowIndex,
      leftColumnIndex,
      rowCount: Math.max(...rowIndexes) - topRowIndex + 1,
      columnCount: Math.max(...columnIndexes) - leftColumnIndex + 1,
    };
    let formulaCell = cellForSumBelow(reads, sheetId, figureArea, area);
    return {
      kind: 'sum',
      ...figures,
      signsOfNumbers: reads.signsOfNumbers,
      heading,
      area: figureArea,
      formulaCell,
    };
  };
  if (area.columnCount === 1) {
    if (plainNumbersOf(body).length === body.length)
      return looksLikeYearColumn(body)
        ? null
        : sumFigure({
            cells: body,
            heading: null,
          });
    return cells.every(isTextOrDate) ? duplicatesFigure(cells) : null;
  }
  let headingsOverBlank = headings.filter(
    ({ rowIndex, columnIndex }) =>
      nonEmptyValueOfCell(reads, reads.cellIdAt(sheetId, rowIndex - 1, columnIndex)) === null,
  );
  let numberColumn = numberColumnWithHeading(body, headingsOverBlank);
  let figure = numberColumn === null ? null : sumFigure(numberColumn);
  if (figure !== null) return figure;
  return cells.length < cellCount && cells.length / cellCount >= MOSTLY_FILLED_SHARE && reads.mergedAreasIn(sheetId, area).length === 0
    ? {
        kind: 'empty',
        count: cellCount - cells.length,
      }
    : null;
}
export function figuresOfRanges(reads: WorkbookReads, sheetId: SheetId, areas: readonly CellArea[]): FigureOfCells | null {
  let [firstArea] = areas;
  if (firstArea === undefined) return null;
  if (areas.reduce((count, area) => count + area.rowCount * area.columnCount, 0) > MAX_FIGURE_CELLS) return null;
  let byPlace = new Map<string, ValuedCell>();
  for (let cell of areas.flatMap((area) => valuedCellsIn(reads, sheetId, area)))
    byPlace.set(`${cell.rowIndex} ${cell.columnIndex}`, cell);
  let cells = [...byPlace.values()];
  let errorCount = cells.filter(({ value }) => value.kind === 'error').length;
  if (errorCount > 0)
    return {
      kind: 'errors',
      count: errorCount,
    };
  let figures = plainNumbersOf(cells).length < 2 ? null : figuresOfCells(cells);
  return figures === null
    ? null
    : {
        kind: 'sum',
        ...figures,
        signsOfNumbers: reads.signsOfNumbers,
        heading: null,
        area: firstArea,
        formulaCell: null,
      };
}
export function figuresOfSelection(state: PageState, reads: ReadsWithTextMeasurer): FigureOfCells | null {
  let overShownRows = readsOverShownRows(state, reads);
  let there = (area: CellArea): CellArea => overShownRows?.there(area) ?? area;
  let figures = figuresOfSelectionIn(state, reads, overShownRows?.reads ?? reads, there);
  if (overShownRows === null || figures?.kind !== 'sum') return figures;
  let area: CellArea = overShownRows.here(figures.area);
  let formulaCell = area.rowCount > figures.area.rowCount ? null : figures.formulaCell;
  return {
    ...figures,
    area,
    formulaCell,
  };
}
export function figuresOfSelectionIn(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  figureReads: WorkbookReads,
  there: (area: CellArea) => CellArea,
): FigureOfCells | null {
  if (hasOtherRanges(state)) {
    let areas = areasOfAllRanges(state, reads).map(there);
    return figuresOfRanges(
      figureReads,
      state.sheetId,
      areas.filter(({ rowCount }) => rowCount > 0),
    );
  }
  let area = selectedArea(state, reads);
  let cellArea = mergedAreaOrCellOf(reads, state.activeCell);
  if (area === null || (cellArea !== null && isSameArea(there(area), there(cellArea)))) return null;
  let selectionKind = selectionKindOf(area, layoutOfView(state, reads));
  return figuresOfArea(figureReads, state.sheetId, there(area), selectionKind);
}
export function insertFigureFormula(state: PageState, reads: ReadsWithTextMeasurer, functionName: string): PageTransition {
  let figures = figuresOfSelection(state, reads);
  if (!isSumWithFormulaCell(figures)) return withNoEffects(state);
  let address = wholeAreaToA1AsStored(figures.area, ownRowOrderOfSheet(reads, state.sheetId));
  if (address === null)
    return withNoEffects({
      ...state,
      notice: {
        kind: 'ownSortInTheWay',
        act: 'referTo',
      },
    });
  let formula = `=${functionName.toUpperCase()}(${address})`;
  return queueEdit(state, enterTextEdit(figures.formulaCell, formula), {
    ...IF_QUEUED_DEFAULTS,
    select: selectionAtCell(figures.formulaCell),
    done: 'formulaAdded',
  });
}
export const isSumWithFormulaCell = (figure: FigureOfCells | null): figure is SumFigure & { formulaCell: CellId } =>
  figure?.kind === 'sum' && figure.formulaCell !== null;
export const MAX_FIGURE_CELLS = 2000;
export const MOSTLY_FILLED_SHARE = 0.8;
export const DATE_TIME_FORMAT_KINDS = new Set<NumberFormatKind | null>(['date', 'time', 'dateAndTime', 'duration']);
export const isDateOrTimeCell = ({ numberFormatKind }: ValuedCell): boolean => DATE_TIME_FORMAT_KINDS.has(numberFormatKind);
export const plainNumbersOf = (cells: readonly ValuedCell[]): number[] =>
  cells.flatMap((cell) => (cell.value.kind === 'number' && !isDateOrTimeCell(cell) ? [cell.value.value] : []));
export const figuresOfCells = (cells: readonly ValuedCell[]): SumFigures | null =>
  sumFigures(
    plainNumbersOf(cells),
    cells.every((cell) => !cell.hasNumberFormat || isDateOrTimeCell(cell)),
  );
export const holdsOneNumber = (reads: WorkbookReads, sheetId: SheetId, position: CellPosition): boolean =>
  plainNumbersOf(valuedCellsIn(reads, sheetId, areaOfPosition(position))).length === 1;
export const roundToDecimals = (number: number, decimals: number): number => Number(number.toFixed(Math.min(100, decimals))) + 0;
export const isTextOrDate = (cell: ValuedCell): boolean => cell.value.kind === 'text' || isDateOrTimeCell(cell);
export const looksLikeYearColumn = ([firstCell]: readonly ValuedCell[]): boolean =>
  firstCell?.value.kind === 'number' &&
  firstCell.numberFormatKind === 'general' &&
  Number.isInteger(firstCell.value.value) &&
  firstCell.value.value >= 1900 &&
  firstCell.value.value <= 2100;
export const isYearCell = (reads: WorkbookReads, sheetId: SheetId, position: CellPosition): boolean =>
  looksLikeYearColumn(valuedCellsIn(reads, sheetId, areaOfPosition(position)));
