import type {
  CellContents,
  ColumnId,
  ColumnPoint,
  Reference,
  RowId,
  RowPoint,
  SheetId,
  SortDirection,
  StoredFormula,
  ValueContents,
} from '@open-artifact/sheets-core';
import { formulaMatchesOutsideReferences, sheetPrefixForFormula } from '../formulas/references.ts';
import { areaOfReference } from '../model/reference-areas.ts';
import { areasOverlap } from '../model/workbook.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { shownCellText } from '../format/shown-text.ts';
import { cellsHangingOnFormulasWhere, areaTouchesHangingCells } from '../formulas/dependents.ts';
import { areaOfPosition, scrollToShowPosition } from '../selection/model.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { sortSourceRows } from '../formulas/lost-formulas.ts';
import { isEntryWorkPending } from '../editor/unanswered-entries.ts';
import { isInSpan } from '../grid/geometry.ts';
import type { PageState, ResultsChanged } from '../state/initial-state.ts';
import type { CellId, CellOnShow, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { ActThatMayLoseFormulas, ColumnsOfTableMoved, PageContext, PageEvent } from '../state/event-reducer.ts';
import type { ColumnsOfTableMoving } from '../selection/move-table-columns.ts';
/** The four edges of a reference: the rows at its top and bottom, the columns at its left and right; `null` where it runs to the end of the sheet. */
export interface ReferenceEdges {
  top: RowPoint | null;
  bottom: RowPoint | null;
  left: ColumnPoint | null;
  right: ColumnPoint | null;
}
/** What a look at the formulas of a sorted area goes by: the area, how far its sheet reaches, and the indexes of its lines by id. */
export interface SortAreaFacts {
  sheetId: SheetId;
  area: CellArea;
  isEveryColumnSorted: boolean;
  lastRowThatShowsAnything: number;
  lastRowIndex: number;
  lastColumnIndex: number;
  rowIndexOf: (rowId: RowId) => number | null;
  columnIndexOf: (columnId: ColumnId) => number | null;
}
/** A formula of a cell in a sorted area, with its text, its row and whether it draws random numbers. */
export interface FormulaInSortedArea {
  formula: StoredFormula;
  text: string;
  rowIndex: number;
  drawsRandomNumbers: boolean;
}
/** How many formulas a column of a sorted area holds, and one of them while they are all the same formula filled down. */
interface FormulasOfColumn {
  count: number;
  oneOfThem: FormulaInSortedArea | null;
}
/** A cell holding a formula, and its row. */
export interface FormulaCellOfRow {
  rowIndex: number;
  cell: CellContents;
}
/** Whether the result of a formula's cell changed, by its sheet, the cell and where it is now. */
export type HasResultChanged = (sheetId: SheetId, cell: CellContents, position: CellPosition) => boolean;
/** The act of sorting an area of rows, as the answer to the sort tells it. */
export type SortedArea = Extract<ActThatMayLoseFormulas, { kind: 'sorted' }>;
/** A sort to look back on once it is answered: the act, the workbook before it, and the column and direction it sorted by. */
export interface SortLookedBackOn {
  sorted: SortedArea;
  before: WorkbookReads;
  column: string;
  direction: SortDirection;
  atChangeCount: number;
}
/** A move of columns of a table to look back on once it is answered: the move, how many columns, and the workbook before it. */
export interface ColumnMoveLookedBackOn {
  moved: ColumnsOfTableMoved;
  count: number;
  before: WorkbookReads;
  atChangeCount: number;
}
/** A sort or a move of columns whose changed results are still to be looked at. */
export type SortOrMoveToLookBackOn = SortLookedBackOn | ColumnMoveLookedBackOn;
export function edgesOfReference(reference: Reference): ReferenceEdges {
  switch (reference.kind) {
    case 'cell': {
      let { cell } = reference;
      return {
        top: cell,
        bottom: cell,
        left: cell,
        right: cell,
      };
    }
    case 'range': {
      let { topLeft, bottomRight } = reference;
      return {
        top: topLeft,
        bottom: bottomRight,
        left: topLeft,
        right: bottomRight,
      };
    }
    case 'columns':
      return {
        ...reference,
        bottom: null,
      };
    case 'rows':
      return {
        ...reference,
        right: null,
      };
  }
}
export function isReferenceKeptBySort(reference: Reference, rowId: RowId, facts: SortAreaFacts) {
  let {
    sheetId,
    area,
    lastRowThatShowsAnything,
    rowIndexOf,
    columnIndexOf,
  } = facts;
  if (reference.sheetId !== sheetId) return true;
  let edges = edgesOfReference(reference);
  let leftIndex = edges.left === null ? 0 : columnIndexOf(edges.left.c);
  let rightIndex = edges.right === null ? facts.lastColumnIndex : columnIndexOf(edges.right.c);
  if (leftIndex === null && edges.left?.c === edges.right?.c) return true;
  let isWithinColumns =
    facts.isEveryColumnSorted ||
    (isIndexInSpan(leftIndex, area.leftColumnIndex, area.columnCount) && isIndexInSpan(rightIndex, area.leftColumnIndex, area.columnCount));
  let [isTopFixed, isBottomFixed] = [isRowFixed(edges.top), isRowFixed(edges.bottom)];
  if (!isTopFixed && !isBottomFixed && edges.top?.r === rowId && edges.bottom?.r === rowId) return isWithinColumns;
  let topIndex = edges.top === null ? 0 : rowIndexOf(edges.top.r);
  let bottomIndex = edges.bottom === null ? facts.lastRowIndex : rowIndexOf(edges.bottom.r);
  if (topIndex === null || bottomIndex === null) return edges.top?.r === edges.bottom?.r;
  let [firstRow, lastRow] = [Math.min(topIndex, bottomIndex), Math.max(topIndex, bottomIndex)];
  if (isTopFixed && isBottomFixed)
    return (
      (leftIndex !== null && rightIndex !== null && Math.max(leftIndex, rightIndex) < area.leftColumnIndex) ||
      (leftIndex !== null && rightIndex !== null && Math.min(leftIndex, rightIndex) >= area.leftColumnIndex + area.columnCount) ||
      lastRow < area.topRowIndex ||
      firstRow > lastRowThatShowsAnything ||
      (firstRow <= area.topRowIndex && lastRow >= lastRowThatShowsAnything)
    );
  let isRowNearArea = (rowIndex: number, isFixed: boolean) =>
    isFixed || isIndexInSpan(rowIndex, area.topRowIndex - 1, area.rowCount + 2);
  return isWithinColumns && isRowNearArea(topIndex, isTopFixed) && isRowNearArea(bottomIndex, isBottomFixed);
}
export function isSameFilledFormula(
  { formula, rowIndex }: FormulaInSortedArea,
  { formula: otherFormula, rowIndex: otherRowIndex }: FormulaInSortedArea,
  { sheetId, rowIndexOf }: SortAreaFacts,
) {
  let isSameRowEdge = (edge: RowPoint | null, otherEdge: RowPoint | null) => {
    if (edge === null || otherEdge === null) return edge === otherEdge;
    if (edge.isRowAbsolute !== otherEdge.isRowAbsolute) return false;
    if (edge.isRowAbsolute) return edge.r === otherEdge.r;
    let [edgeRow, otherEdgeRow] = [rowIndexOf(edge.r), rowIndexOf(otherEdge.r)];
    return edgeRow !== null && otherEdgeRow !== null && edgeRow - rowIndex === otherEdgeRow - otherRowIndex;
  };
  return (
    formula.references.length === otherFormula.references.length &&
    formula.textBetweenReferences.every((text, nth) => text === otherFormula.textBetweenReferences[nth]) &&
    formula.references.every((reference, nth) => {
      let otherReference = otherFormula.references[nth];
      if (reference.kind !== otherReference?.kind || reference.sheetId !== otherReference.sheetId) return false;
      if (reference.sheetId !== sheetId) return true;
      let [edges, otherEdges] = [edgesOfReference(reference), edgesOfReference(otherReference)];
      return (
        isSameRowEdge(edges.top, otherEdges.top) &&
        isSameRowEdge(edges.bottom, otherEdges.bottom) &&
        isSameColumnEdge(edges.left, otherEdges.left) &&
        isSameColumnEdge(edges.right, otherEdges.right)
      );
    })
  );
}
export function memoizeByKey<Key, Value>(compute: (key: Key) => Value) {
  let cache = new Map<Key, Value>();
  return (key: Key) => {
    let cached = cache.get(key);
    if (cached !== undefined) return cached;
    let computed = compute(key);
    cache.set(key, computed);
    return computed;
  };
}
export function sortAreaFacts(reads: WorkbookReads, sheetId: SheetId, area: CellArea): SortAreaFacts | null {
  let shownArea = reads.areaOnShowIn(sheetId, area);
  let lines = reads.linesOf(sheetId);
  if (shownArea === null || lines === null) return null;
  return {
    sheetId,
    area,
    isEveryColumnSorted: area.columnCount === lines.columns.count,
    lastRowThatShowsAnything: shownArea.topRowIndex + shownArea.rowCount - 1,
    lastRowIndex: lines.rows.count - 1,
    lastColumnIndex: lines.columns.count - 1,
    rowIndexOf: memoizeByKey((rowId: RowId) => reads.rowIndexOf(sheetId, rowId)),
    columnIndexOf: memoizeByKey((columnId: ColumnId) => reads.columnIndexOf(sheetId, columnId)),
  };
}
export function dependsOnOtherRows(
  reads: WorkbookReads,
  { formula, text, rowIndex, drawsRandomNumbers }: FormulaInSortedArea,
  changedColumns: ReadonlySet<number>,
  { sheetId, area, rowIndexOf }: SortAreaFacts,
) {
  let isOwnRowEdge = (edge: RowPoint | null) => !isRowFixed(edge) && edge !== null && rowIndexOf(edge.r) === rowIndex;
  return (
    drawsRandomNumbers ||
    formulaMatchesOutsideReferences(text, ROW_DEPENDENT_FUNCTION_PATTERN, reads.decimalSign) ||
    formula.references.some((reference) => {
      if (reference.sheetId !== sheetId) return false;
      let { top, bottom } = edgesOfReference(reference);
      if (!(isRowFixed(top) && isRowFixed(bottom)) && !(isOwnRowEdge(top) && isOwnRowEdge(bottom))) return true;
      let referencedArea = areaOfReference(reads, reference);
      if (referencedArea === null) return false;
      for (let columnIndex of changedColumns)
        if (
          areasOverlap(referencedArea, {
            ...area,
            leftColumnIndex: columnIndex,
            columnCount: 1,
          })
        )
          return true;
      return false;
    })
  );
}
export function orderDependentColumns(reads: WorkbookReads, sheetId: SheetId, area: CellArea) {
  let facts = sortAreaFacts(reads, sheetId, area);
  if (facts === null) return new Set<number>();
  let rowsWithCells = 0;
  let formulaColumns = new Map<number, FormulasOfColumn>();
  for (let [rowId, cellsOfRow] of reads.cellsHeldByRow(sheetId)) {
    let rowIndex = facts.rowIndexOf(rowId);
    if (!isIndexInSpan(rowIndex, area.topRowIndex, area.rowCount)) continue;
    let hasCells = false;
    for (let [columnId, cell] of cellsOfRow) {
      let { input, spill, formulaText = '', drawsRandomNumbers = false } = cell;
      let columnIndex = facts.columnIndexOf(columnId);
      if (!isIndexInSpan(columnIndex, area.leftColumnIndex, area.columnCount)) continue;
      hasCells = true;
      if (input.kind !== 'formula') continue;
      let formulaCell: FormulaInSortedArea = {
        formula: input.formula,
        text: formulaText,
        rowIndex,
        drawsRandomNumbers,
      };
      let columnFacts: FormulasOfColumn = formulaColumns.get(columnIndex) ?? {
        count: 0,
        oneOfThem: formulaCell,
      };
      formulaColumns.set(columnIndex, columnFacts);
      columnFacts.count += 1;
      if (
        !(
          columnFacts.oneOfThem !== null &&
          spill === undefined &&
          formulaCell.formula.references.every((reference) => isReferenceKeptBySort(reference, rowId, facts)) &&
          isSameFilledFormula(columnFacts.oneOfThem, formulaCell, facts)
        )
      )
        columnFacts.oneOfThem = null;
    }
    if (hasCells) rowsWithCells += 1;
  }
  if (rowsWithCells !== facts.lastRowThatShowsAnything - area.topRowIndex + 1) return new Set<number>();
  let changedColumns = new Set<number>();
  for (let isGrowing = true; isGrowing; ) {
    isGrowing = false;
    for (let [columnIndex, { count, oneOfThem }] of formulaColumns) {
      if (oneOfThem === null || count !== rowsWithCells || changedColumns.has(columnIndex)) continue;
      if (!dependsOnOtherRows(reads, oneOfThem, changedColumns, facts)) continue;
      changedColumns.add(columnIndex);
      isGrowing = true;
    }
  }
  return changedColumns;
}
export function isSameCellValue(cell: CellOnShow, otherCell: CellOnShow) {
  let [value, otherValue] = [cellValueOf(cell), cellValueOf(otherCell)];
  if (cellValueKey(value) === cellValueKey(otherValue)) return true;
  if (value?.kind !== 'number' || otherValue?.kind !== 'number') return false;
  if (Number.isSafeInteger(value.value) && Number.isSafeInteger(otherValue.value)) return false;
  let [shown, otherShown] = [cell, otherCell].map((eitherCell) => shownCellText(eitherCell, 1 / 0, 'point'));
  return JSON.stringify(shown) === JSON.stringify(otherShown);
}
export function compareCellValues(cell: CellOnShow, otherCell: CellOnShow) {
  let [value, otherValue] = [cellValueOf(cell), cellValueOf(otherCell)];
  if (value?.kind === 'number' && otherValue?.kind === 'number') return value.value - otherValue.value;
  let [key, otherKey] = [value, otherValue].map((eitherValue) => `${eitherValue?.kind} ${eitherValue?.value}`);
  return key === otherKey ? 0 : (key ?? '') < (otherKey ?? '') ? -1 : 1;
}
export function resultCellsOfFormula(reads: WorkbookReads, sheetId: SheetId, cell: CellContents | null): CellOnShow[] | null {
  if (cell?.input.kind !== 'formula' || cell.value === undefined) return null;
  let spillArea =
    cell.spill?.kind === 'fills'
      ? reads.spillOver({
          sheetId,
          rowId: cell.r,
          columnId: cell.c,
        })?.area
      : undefined;
  if (spillArea === undefined) return [cell];
  let cells = reads.cellsOnShowIn(sheetId, spillArea).flatMap((cellId) => reads.cellOnShowIn(cellId) ?? []);
  cells.sort(compareCellValues);
  return cells;
}
export function rowsWhoseResultsChanged(before: FormulaCellOfRow[], after: FormulaCellOfRow[]) {
  for (let formulaCells of [before, after])
    formulaCells.sort((first, second) => compareCellValues(first.cell, second.cell));
  let changedRows = new Set<number>();
  let beforeIndex = 0;
  for (let { rowIndex, cell: afterCell } of after) {
    let isFound = false;
    for (let beforeEntry = before[beforeIndex]; beforeEntry !== undefined && !isFound; beforeEntry = before[beforeIndex]) {
      isFound = isSameCellValue(beforeEntry.cell, afterCell);
      if (!isFound && compareCellValues(beforeEntry.cell, afterCell) >= 0) break;
      beforeIndex += 1;
    }
    if (!isFound) changedRows.add(rowIndex);
  }
  return changedRows;
}
export function changedFormulaResults(
  readsBefore: WorkbookReads,
  readsAfter: WorkbookReads,
  sheetIdOfAct: SheetId,
  hasResultChanged: HasResultChanged,
): ResultsChanged | null {
  let cellsHangingOnNowOrToday: NonNullable<ReturnType<typeof cellsHangingOnFormulasWhere>> | 'tooManyToTell' | null = null;
  let isChangeNotFromTimeZone = (sheetId: SheetId, cell: CellContents, position: CellPosition) => {
    if (readsBefore.timeZone === readsAfter.timeZone) return true;
    if (cell.value?.kind === 'error' && cell.value.value !== '#N/A') return true;
    cellsHangingOnNowOrToday ??=
      cellsHangingOnFormulasWhere(
        readsAfter,
        (formulaText: string) => formulaMatchesOutsideReferences(formulaText, NOW_OR_TODAY_PATTERN, readsAfter.decimalSign),
      ) ?? 'tooManyToTell';
    return cellsHangingOnNowOrToday !== 'tooManyToTell' && !areaTouchesHangingCells(cellsHangingOnNowOrToday, sheetId, areaOfPosition(position));
  };
  let [changedCount, changedErrorCount] = [0, 0];
  let firstCellText: string | null = null;
  let sheets = readsAfter.listSheets();
  for (let { sheetId, name: sheetName } of sheets) {
    if (readsBefore.sheetAsItStands(sheetId) === readsAfter.sheetAsItStands(sheetId)) continue;
    let changedPositions: CellPosition[] = [];
    let visitCell = (cell: CellContents) => {
      if (cell.input.kind !== 'formula') return;
      let position = readsAfter.positionOfCell({
        sheetId,
        rowId: cell.r,
        columnId: cell.c,
      });
      if (position === null || !hasResultChanged(sheetId, cell, position)) return;
      if (!isChangeNotFromTimeZone(sheetId, cell, position)) return;
      changedPositions.push(position);
      if (cell.value?.kind === 'error') changedErrorCount += 1;
    };
    let cellsBeforeByRow = readsBefore.cellsHeldByRow(sheetId);
    for (let [rowId, cellsOfRow] of readsAfter.cellsHeldByRow(sheetId)) {
      if (cellsBeforeByRow.get(rowId) === cellsOfRow) continue;
      for (let cellOfRow of cellsOfRow.values()) if (cellOfRow.spill === undefined) visitCell(cellOfRow);
    }
    readsAfter.cellsWithSpillIn(sheetId).forEach(visitCell);
    changedCount += changedPositions.length;
    let [firstChanged, ...otherChanged] = changedPositions;
    if (firstChanged === undefined || (firstCellText !== null && sheetId !== sheetIdOfAct)) continue;
    let earliestChanged = otherChanged.reduce(
      (earliest, position) => (comesBeforeInReadingOrder(position, earliest) ? position : earliest),
      firstChanged,
    );
    let cellAddress: string = areaToA1AsStored(areaOfPosition(earliestChanged), ownRowOrderOfSheet(readsAfter, sheetId));
    firstCellText = sheets.length === 1 ? cellAddress : `${sheetPrefixForFormula(sheetName)}${cellAddress}`;
  }
  return firstCellText === null
    ? null
    : {
        count: changedCount,
        errorCount: changedErrorCount,
        firstCell: firstCellText,
      };
}
export function resultsChangedBySort(readsBeforeSort: WorkbookReads, readsAfterSort: WorkbookReads, sorted: SortedArea) {
  let readsBefore = readsBeforeSort.asStored() ?? readsBeforeSort;
  let readsAfter = readsAfterSort.asStored() ?? readsAfterSort;
  let { area } = sorted;
  let columnsExpectedToChange: Set<number> | null = null;
  let sourceRows: (number | null)[] | null = null;
  let unmatchedRowsByColumn = new Map<number, Set<number>>();
  let sourceRowOf = (rowIndex: number) => {
    sourceRows ??= sortSourceRows(readsBefore, readsAfter, sorted);
    let rowOffset = sourceRows[rowIndex - area.topRowIndex] ?? null;
    return rowOffset === null ? null : area.topRowIndex + rowOffset;
  };
  let cellBeforeSortAt = ({ rowIndex, columnIndex }: CellPosition) => {
    let sourceRow = sourceRowOf(rowIndex);
    let cellId = sourceRow === null ? null : readsBefore.cellIdAt(sorted.sheetId, sourceRow, columnIndex);
    return cellId === null ? null : readsBefore.cellOf(cellId);
  };
  let isResultUnmatchedInColumn = ({ rowIndex, columnIndex }: CellPosition) => {
    let unmatchedRows = unmatchedRowsByColumn.get(columnIndex);
    if (unmatchedRows === undefined) {
      let rowIndexes = Array.from(
        {
          length: area.rowCount,
        },
        (_, offset) => area.topRowIndex + offset,
      );
      let sourceRowsUsed = new Set(rowIndexes.map(sourceRowOf));
      let formulaCellsOfRows = (reads: WorkbookReads, keepsRow: (rowIndex: number) => boolean): FormulaCellOfRow[] =>
        rowIndexes.filter(keepsRow).flatMap((keptRowIndex) => {
          let cellId = reads.cellIdAt(sorted.sheetId, keptRowIndex, columnIndex);
          let cell = cellId === null ? null : reads.cellOf(cellId);
          return cell?.input.kind === 'formula'
            ? [
                {
                  rowIndex: keptRowIndex,
                  cell,
                },
              ]
            : [];
        });
      let formulaCellsBefore = formulaCellsOfRows(readsBefore, (rowIndexBefore) => !sourceRowsUsed.has(rowIndexBefore));
      unmatchedRows = formulaCellsBefore.some(({ cell }) => cell.value === undefined)
        ? new Set<number>()
        : rowsWhoseResultsChanged(
            formulaCellsBefore,
            formulaCellsOfRows(readsAfter, (rowIndexAfter) => sourceRowOf(rowIndexAfter) === null),
          );
      unmatchedRowsByColumn.set(columnIndex, unmatchedRows);
    }
    return unmatchedRows.has(rowIndex);
  };
  let hasResultChanged = (sheetId: SheetId, cell: CellContents, position: CellPosition) => {
    let valuesAfter = resultCellsOfFormula(readsAfter, sheetId, cell);
    if (valuesAfter === null) return false;
    let isInSortedRows =
      sheetId === sorted.sheetId && position.rowIndex >= area.topRowIndex && position.rowIndex < area.topRowIndex + area.rowCount;
    if (!(isInSortedRows && position.columnIndex >= area.leftColumnIndex && position.columnIndex < area.leftColumnIndex + area.columnCount)) {
      let cellIdBefore = readsBefore.cellIdAt(sheetId, position.rowIndex, position.columnIndex);
      let valuesBefore = resultCellsOfFormula(readsBefore, sheetId, cellIdBefore === null ? null : readsBefore.cellOf(cellIdBefore));
      if (valuesBefore === null || areSameCellValues(valuesBefore, valuesAfter)) return false;
      if (!isInSortedRows) return true;
      let valuesAtSourceRow = resultCellsOfFormula(readsBefore, sheetId, cellBeforeSortAt(position));
      return valuesAtSourceRow === null || !areSameCellValues(valuesAtSourceRow, valuesAfter);
    }
    if (sourceRowOf(position.rowIndex) === null) {
      if (!isResultUnmatchedInColumn(position)) return false;
    } else {
      let cellBefore = cellBeforeSortAt(position);
      let valuesBefore = resultCellsOfFormula(readsBefore, sheetId, cellBefore);
      if (valuesBefore === null) return false;
      if (!isSpillFromRow(cell) && (cellBefore?.spill ?? cell.spill) !== undefined)
        return !areSameCellValues(valuesBefore, valuesAfter) || sourceRowOf(position.rowIndex) !== position.rowIndex;
      if (columnsExpectedToChange?.has(position.columnIndex) === true || areSameCellValues(valuesBefore, valuesAfter)) return false;
    }
    columnsExpectedToChange ??= orderDependentColumns(readsBefore, sheetId, area);
    return !columnsExpectedToChange.has(position.columnIndex);
  };
  return changedFormulaResults(readsBefore, readsAfter, sorted.sheetId, hasResultChanged);
}
export function columnMoveToLookBackOn(event: PageEvent, state: PageState): ColumnMoveLookedBackOn | null {
  if (event.kind !== 'editAnswered' || event.outcome.kind !== 'editQueued') return null;
  let { movesColumnsOfTable: moved } = event.ifQueued;
  if (moved === undefined || moved.before === null) return null;
  let { before, count } = moved;
  return {
    moved,
    count,
    before,
    atChangeCount: state.workbookChangeCount,
  };
}
export function sortToLookBackOnFromAnswer(event: PageEvent, state: PageState): SortLookedBackOn | null {
  if (event.kind !== 'editAnswered' || event.outcome.kind !== 'editQueued') return null;
  let { before: actBefore, ifQueued } = event;
  let done = typeof ifQueued.done === 'object' ? ifQueued.done : null;
  if (actBefore?.act.kind !== 'sorted') return null;
  if (done?.what !== 'rowsSorted' && done?.what !== 'cellsSorted') return null;
  let { column, direction } = done;
  return {
    sorted: actBefore.act,
    before: actBefore.reads,
    column,
    direction,
    atChangeCount: state.workbookChangeCount,
  };
}
export function offerUndoIfEditChangedResults(state: PageState, event: PageEvent, context: PageContext) {
  let settled = settleMoveOfColumnsAnswer(state, event, context.reads);
  return offerUndoIfSortChangedResults(settled, event, context);
}
export function settleMoveOfColumnsAnswer(state: PageState, event: PageEvent, reads: ReadsWithTextMeasurer): PageState {
  if (event.kind !== 'editAnswered' || event.ifQueued.movesColumnsOfTable === undefined) return state;
  let answered = {
    ...state,
    moveOfColumnsUnanswered: null,
  };
  if (event.outcome.kind !== 'editQueued')
    return {
      ...answered,
      ...event.ifQueued.movesColumnsOfTable.selectedIfNotMade,
    };
  if (event.ifQueued.isViewLeftAsItIs === true) return answered;
  let scrollToCell = (scrolled: PageState, cellId: CellId) => {
    let position = reads.positionOfCell(cellId);
    return position === null
      ? scrolled
      : scrollToShowPosition(
          scrolled,
          reads,
          position,
          {
            rows: false,
            columns: true,
          },
          'pointer',
        );
  };
  return scrollToCell(scrollToCell(answered, answered.selectionCorner), answered.activeCell);
}
export function offerUndoIfSortChangedResults(state: PageState, event: PageEvent, context: PageContext): PageState {
  let { reads } = context;
  let sortToLookBackOn = sortToLookBackOnFromAnswer(event, state) ?? columnMoveToLookBackOn(event, state) ?? state.sortToLookBackOn;
  if (sortToLookBackOn === null) return state;
  if (sortToLookBackOn.atChangeCount !== state.workbookChangeCount || context.refusalOfEveryEdit !== null)
    return {
      ...state,
      sortToLookBackOn: null,
    };
  if (isEntryWorkPending(state, context) || !context.areReadsTheLatest)
    return sortToLookBackOn === state.sortToLookBackOn
      ? state
      : {
          ...state,
          sortToLookBackOn,
        };
  let tookTooLong = sortToLookBackOn.before.calculationTookTooLong || reads.calculationTookTooLong;
  if ('moved' in sortToLookBackOn) {
    let changedResults = tookTooLong ? null : resultsChangedByColumnMove(sortToLookBackOn.before, reads, sortToLookBackOn.moved);
    return {
      ...state,
      sortToLookBackOn: null,
      ...(changedResults !== null && {
        undoOffer: {
          kind: 'moveOfColumnsChangedResults',
          count: sortToLookBackOn.count,
          results: changedResults,
          isSaved: state.saving === 'allSaved',
        },
      }),
    };
  }
  let { sorted, before: readsBefore, column, direction } = sortToLookBackOn;
  let changedResults = tookTooLong ? null : resultsChangedBySort(readsBefore, reads, sorted);
  return {
    ...state,
    sortToLookBackOn: null,
    ...(changedResults !== null && {
      undoOffer: {
        kind: 'sortChangedResults',
        column,
        direction,
        results: changedResults,
        isSaved: state.saving === 'allSaved',
      },
    }),
  };
}
/** Whether an index is found (not `null`) and lies in the span of `count` lines from `start`. */
export const isIndexInSpan = (index: number | null, start: number, count: number): index is number =>
  index !== null && index >= start && index < start + count;
export const isRowFixed = (edge: RowPoint | null) => edge?.isRowAbsolute ?? true;
export const isSameColumnEdge = (edge: ColumnPoint | null, otherEdge: ColumnPoint | null) =>
  edge?.c === otherEdge?.c && edge?.isColumnAbsolute === otherEdge?.isColumnAbsolute;
export const ROW_DEPENDENT_FUNCTION_PATTERN = /\b(?:ROW|OFFSET|INDIRECT)\s*\(/i;
export const cellValueKey = (value: ValueContents | null) =>
  `${value?.kind} ${value?.kind === 'number' ? value.value.toPrecision(15) : value?.value}`;
export const areSameCellValues = (cells: readonly CellOnShow[], otherCells: readonly CellOnShow[]) =>
  cells.length === otherCells.length &&
  cells.every((cell, nth) => {
    let otherCell = otherCells[nth];
    return otherCell !== undefined && isSameCellValue(cell, otherCell);
  });
export const isSpillFromRow = ({ r, spill }: Pick<CellContents, 'r' | 'spill'>): boolean =>
  (spill?.kind === 'fills' ? spill.to : spill?.wouldFillTo)?.r === r;
export const NOW_OR_TODAY_PATTERN = /\b(?:NOW|TODAY)\s*\(/i;
export const comesBeforeInReadingOrder = (first: CellPosition, second: CellPosition) =>
  first.rowIndex === second.rowIndex ? first.columnIndex < second.columnIndex : first.rowIndex < second.rowIndex;
export const resultsChangedByColumnMove = (
  readsBefore: WorkbookReads,
  readsAfter: WorkbookReads,
  { sheetId: sheetIdMoved, area, cameFrom }: Pick<ColumnsOfTableMoving, 'sheetId' | 'area' | 'cameFrom'>,
) =>
  changedFormulaResults(readsBefore, readsAfter, sheetIdMoved, (sheetId, cell, position) => {
    let valuesAfter = resultCellsOfFormula(readsAfter, sheetId, cell);
    if (valuesAfter === null) return false;
    let columnBefore =
      (sheetId === sheetIdMoved && isInSpan(position.rowIndex, area.topRowIndex, area.rowCount)
        ? cameFrom[position.columnIndex - area.leftColumnIndex]
        : undefined) ?? position.columnIndex;
    let cellIdBefore = readsBefore.cellIdAt(sheetId, position.rowIndex, columnBefore);
    let valuesBefore = resultCellsOfFormula(readsBefore, sheetId, cellIdBefore === null ? null : readsBefore.cellOf(cellIdBefore));
    return valuesBefore !== null && !areSameCellValues(valuesBefore, valuesAfter);
  });
