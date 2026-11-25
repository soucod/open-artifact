import type { SheetId } from '@open-artifact/sheets-core';
import type { PageState } from './initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import { nonEmptyValueOfCell, DATE_TIME_FORMAT_KINDS, sumFigures } from '../selection/figures.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { isGeneralPattern } from '../model/cell-format.ts';
import { isSameCell, mergedAreaOrCellOf, isSameArea, isSameSelection } from '../selection/model.ts';
import { areasOfAllRanges, coveredCellCount } from '../selection/several-ranges.ts';
import { shownPiecesOfArea, makeIsCellFilteredOut } from '../tables/filtered-rows.ts';
export function figuresOfShownCells(
  reads: WorkbookReads,
  sheetId: SheetId,
  ranges: readonly CellArea[],
  isLeftOut: (cell: CellId) => boolean,
): Figures | null {
  let seenCells = ranges.length > 1 ? new Set<string>() : null;
  let numbers: number[] = [];
  let count: number = 0;
  let pattern: string | null = null;
  let areAllGeneral: boolean = true;
  for (let range of ranges)
    for (let cellId of reads.cellsOnShowIn(sheetId, range)) {
      let cellValue = nonEmptyValueOfCell(reads, cellId);
      if (cellValue === null || isLeftOut(cellId)) continue;
      let cellKey = seenCells === null ? '' : `${cellId.rowId} ${cellId.columnId}`;
      if (seenCells?.has(cellKey) === true) continue;
      seenCells?.add(cellKey);
      count += 1;
      if (cellValue.kind !== 'number') continue;
      let numberFormat = numberFormatOfCell(reads, cellId);
      if (DATE_TIME_FORMAT_KINDS.has(numberFormat.kind)) continue;
      pattern = numbers.length === 0 || pattern === numberFormat.pattern ? numberFormat.pattern : null;
      areAllGeneral &&= isGeneralPattern(numberFormat.pattern);
      numbers.push(cellValue.value);
    }
  if (count === 0) return null;
  let figuresOfCount: FiguresOfCount = {
    count: {
      value: count,
      written: null,
    },
  };
  let numberFigures = numbers.length === 0 ? null : sumFigures(numbers, areAllGeneral);
  if (numberFigures === null) return figuresOfCount;
  let sharedPattern = areAllGeneral ? null : pattern;
  let figureOf = (figureValue: number, valueWritten: number = figureValue): Figure => {
    let written =
      sharedPattern === null
        ? null
        : reads.shownWithRoomForAll(
            {
              kind: 'number',
              value: valueWritten,
            },
            sharedPattern,
          );
    return {
      value: figureValue,
      written: written === '' ? null : written,
    };
  };
  return {
    sum: figureOf(numberFigures.sum),
    average: figureOf(numberFigures.average, numberFigures.sum / numbers.length),
    min: figureOf(numberFigures.min),
    max: figureOf(numberFigures.max),
    ...figuresOfCount,
  };
}
export function updateFiguresOfSelection(stateBefore: PageState | null, state: PageState, reads: WorkbookReads, isDue: boolean): PageState {
  let figuresBefore = state.figuresOfSelection;
  let isWorkbookUnchanged =
    stateBefore !== null &&
    state.workbookChangeCount === stateBefore.workbookChangeCount &&
    state.formulasWorkedOutCount === stateBefore.formulasWorkedOutCount;
  if (
    (stateBefore !== null &&
      isWorkbookUnchanged &&
      state.sheetId === stateBefore.sheetId &&
      state.mode.kind === stateBefore.mode.kind &&
      isSameCell(state.activeCell, stateBefore.activeCell) &&
      isSameCell(state.selectionCorner, stateBefore.selectionCorner) &&
      state.rangeWalked === stateBefore.rangeWalked &&
      state.otherRanges === stateBefore.otherRanges &&
      state.rowsOutOfViewByOwnFilters === stateBefore.rowsOutOfViewByOwnFilters &&
      !(isDue && figuresBefore.areDue)) ||
    state.mode.kind === 'editing'
  )
    return state;
  let withFigures = (nextFigures: FiguresOfSelection): PageState =>
    nextFigures === figuresBefore
      ? state
      : {
          ...state,
          figuresOfSelection: nextFigures,
        };
  let areas = areasOfAllRanges(state, reads);
  let [firstArea] = areas;
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  let isOneMergedArea =
    areas.length === 1 && firstArea !== undefined && activeArea !== null && isSameArea(firstArea, activeArea);
  let cellCount = coveredCellCount(areas);
  if (cellCount < 2 || isOneMergedArea || cellCount > MAX_CELLS_FIGURED) return withFigures(NO_FIGURES_OF_SELECTION);
  let cellsKey = [
    state.sheetId,
    ...areas.flatMap(
      (area) => shownPiecesOfArea(state, reads, area).map((piece: CellArea) => Object.values(piece).join(',')),
    ),
  ].join(' ');
  let workbookKey = `${state.workbookChangeCount} ${state.formulasWorkedOutCount}`;
  let areSameCells = isWorkbookUnchanged ? cellsKey === figuresBefore.ofCells : stateBefore !== null && isSameSelection(stateBefore, state);
  if (areSameCells && workbookKey === figuresBefore.ofWorkbook && !figuresBefore.areDue) return state;
  if (!isDue && cellCount > MAX_CELLS_FIGURED_AT_ONCE) {
    if (areSameCells && figuresBefore.areDue) return state;
    return withFigures({
      ...figuresBefore,
      figures: areSameCells ? figuresBefore.figures : null,
      areDue: true,
      ofCells: cellsKey,
    });
  }
  let figures = figuresOfShownCells(reads, state.sheetId, areas, makeIsCellFilteredOut(state, reads));
  return withFigures({
    figures,
    areDue: false,
    ofCells: cellsKey,
    ofWorkbook: workbookKey,
  });
}
export const MAX_CELLS_FIGURED_AT_ONCE = 5000;
export const MAX_CELLS_FIGURED = 500000;
export const NO_FIGURES_OF_SELECTION: FiguresOfSelection = {
  figures: null,
  areDue: false,
  ofCells: '',
  ofWorkbook: '',
};
export interface Figure {
  value: number;
  written: string | null;
}
export interface CountFigure {
  value: number;
  written: null;
}
export interface FiguresOfCount {
  count: CountFigure;
}
export interface FiguresOfNumbers extends FiguresOfCount {
  sum: Figure;
  average: Figure;
  min: Figure;
  max: Figure;
}
export type Figures = FiguresOfCount | FiguresOfNumbers;
export interface FiguresOfSelection {
  figures: Figures | null;
  areDue: boolean;
  ofCells: string;
  ofWorkbook: string;
}
