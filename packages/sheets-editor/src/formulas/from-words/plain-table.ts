import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import { cellValueOf } from '../../model/cell-values.ts';
import { areaOfReference } from '../../model/reference-areas.ts';
import { MOST_CELLS_LOOKED_AT, holdsOfEachColumn, holdsOfArea } from './area-holds.ts';
import { headedColumnsMatchingWord } from '../column-headings.ts';
import { parseA1Area } from '../../model/a1-references.ts';
import type { CellId, SheetRead, SheetSummary, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { AreaHolds } from './area-holds.ts';
/** A column under a heading in the first row, and the cells of it under the heading, in A1 terms. */
export interface HeadedColumn {
  columnId: ColumnId;
  heading: string;
  cells: string;
}
/** The rows of a table read as plain records, with what each of its columns holds. */
interface RecordsTable {
  sheetId: SheetId;
  rowIds: RowId[];
  rows: CellArea;
  columnIndexes: number[];
  held: AreaHolds[];
}
export function isSummaryRow(
  workbook: WorkbookReads,
  { sheetId, columnIndexes, held }: RecordsTable,
  rowIndex: number,
  neighbourRowIndex: number,
) {
  let cellIdsInRow = (rowIndexOfCells: number) =>
    columnIndexes.map((columnIndex) => workbook.cellIdAt(sheetId, rowIndexOfCells, columnIndex));
  let valueOfCellId = (cellId: CellId | null) => (cellId === null ? null : cellValueOf(workbook.cellOnShowIn(cellId)));
  let isFormulaCell = (cellId: CellId | null) => cellId !== null && workbook.cellOf(cellId)?.input.kind === 'formula';
  let [rowCells, neighbourCells] = [cellIdsInRow(rowIndex), cellIdsInRow(neighbourRowIndex)];
  let firstValue = valueOfCellId(rowCells[0] ?? null);
  let firstText = firstValue?.kind === 'text' ? firstValue.value.trim() : '';
  if (SUMMARY_LABEL_PATTERN.test(firstText) || REFERENCE_LABEL_PATTERN.test(firstText) || firstText.endsWith(':')) return true;
  let isLoneLabelOverNumbers = (cellId: CellId | null, columnOffset: number) => {
    let { textCount = 0, numberCount = 0 } = held[columnOffset] ?? {};
    return valueOfCellId(cellId)?.kind === 'text' && textCount === 1 && numberCount > 1;
  };
  if (rowCells.some(isLoneLabelOverNumbers)) return true;
  let isFormulaOverPlainValue = (cellId: CellId | null, columnOffset: number) =>
    isFormulaCell(cellId) && valueOfCellId(neighbourCells[columnOffset] ?? null) !== null && !isFormulaCell(neighbourCells[columnOffset] ?? null);
  if (rowCells.some(isFormulaOverPlainValue)) return true;
  let summaryKinds = rowCells.flatMap((cellId, columnOffset): ('sum' | 'average' | 'neither')[] => {
    let [value, { sum = 0, numberCount = 0 } = {}] = [valueOfCellId(cellId), held[columnOffset]];
    if (value?.kind !== 'number' || numberCount <= MIN_NUMBERS_FOR_SUMMARY_ROW) return [];
    let sumOfOthers = sum - value.value;
    if (value.value !== 0 && isNearlyEqualAsShown(value.value, sumOfOthers)) return ['sum'];
    let [lowest = 0, highest = 0] = held[columnOffset]?.numbersLieIn ?? [];
    if (isNearlyEqualAsShown(value.value, value.value + (highest - lowest) / 20)) return [];
    return [value.value !== 0 && isNearlyEqualAsShown(value.value, sumOfOthers / (numberCount - 1)) ? 'average' : 'neither'];
  });
  return summaryKinds.includes('sum') || (summaryKinds.length > 0 && !summaryKinds.includes('neither'));
}
export function hasSubtotalRows({ rowIds, held }: RecordsTable) {
  let runningSums = held.map(
    () => ({
      sum: 0,
      count: 0,
    }),
  );
  let headingColumns = held.flatMap(
    ({ textCount, numberCount }, columnOffset) =>
      columnOffset > 0 && textCount > 0 && numberCount === 0 ? [columnOffset] : [],
  );
  let [subtotalRowCount, rowsSinceSubtotal] = [0, 0];
  for (let rowId of rowIds) {
    let rowNumbers = held.map(({ byRow }) => byRow.get(rowId));
    if (held.length > 1 && rowNumbers.filter((number) => number !== undefined).length < 2) return true;
    if (headingColumns.length > 0 && headingColumns.every((columnOffset) => rowNumbers[columnOffset] === undefined)) return true;
    let numbersWithColumn = rowNumbers.flatMap(
      (number, columnOffset): [number, number][] => (typeof number === 'number' ? [[number, columnOffset]] : []),
    );
    let isSubtotalOfColumn = ([value, columnOffset]: [number, number]) => {
      let { sum = 0, count = 0 } = runningSums[columnOffset] ?? {};
      return count > 1 && value !== 0 && isNearlyEqualAsShown(value, sum);
    };
    let isSubtotalRow = numbersWithColumn.length > 0 && numbersWithColumn.every(isSubtotalOfColumn);
    [subtotalRowCount, rowsSinceSubtotal] = isSubtotalRow ? [subtotalRowCount + 1, 0] : [subtotalRowCount, rowsSinceSubtotal + 1];
    for (let [columnOffset, runningSum] of runningSums.entries()) {
      let number = isSubtotalRow ? undefined : rowNumbers[columnOffset];
      if (isSubtotalRow) [runningSum.sum, runningSum.count] = [0, 0];
      else if (typeof number === 'number') [runningSum.sum, runningSum.count] = [runningSum.sum + number, runningSum.count + 1];
    }
  }
  return subtotalRowCount > 1 && rowsSinceSubtotal === 0;
}
export function hasSectionHeadingRows(workbook: WorkbookReads, { sheetId, rows, columnIndexes }: RecordsTable) {
  let filledCountsPerRow = Array.from(
    {
      length: rows.rowCount,
    },
    (_, rowOffset) =>
      columnIndexes.slice(1).filter((columnIndex) => {
        let cellId = workbook.cellIdAt(sheetId, rows.topRowIndex + rowOffset, columnIndex);
        let inputKind = cellId === null ? undefined : workbook.cellOf(cellId)?.input.kind;
        return inputKind !== undefined && inputKind !== 'formula';
      }).length,
  );
  return filledCountsPerRow.includes(0) && filledCountsPerRow.some((filledCount) => filledCount > 0);
}
export function rowBelowBreaksTable(
  workbook: WorkbookReads,
  sheetId: SheetId,
  rowArea: CellArea,
  tableTopRowIndex: number,
  tableEndRowIndex: number,
) {
  let filled = workbook.filledCellsIn(sheetId, rowArea).map(
    (cellId) => ({
      input: workbook.cellOf(cellId)?.input,
      columnIndex: workbook.positionOfCell(cellId)?.columnIndex ?? -1,
    }),
  );
  if (filled.filter(({ input }) => input?.kind === 'text' || input?.kind === 'richText').length > 1) return true;
  return filled.some(
    ({ input, columnIndex }) =>
      (input?.kind === 'formula' ? input.formula.references : []).some((reference) => {
        if (reference.kind !== 'cell' && reference.sheetId !== sheetId) return true;
        let area = reference.kind === 'cell' ? null : areaOfReference(workbook, reference);
        return (
          area !== null &&
          area.leftColumnIndex <= columnIndex &&
          columnIndex < area.leftColumnIndex + area.columnCount &&
          (area.topRowIndex > tableTopRowIndex || area.topRowIndex + area.rowCount < tableEndRowIndex)
        );
      }),
  );
}
export function formulaReadsRowsAbove(workbook: WorkbookReads, cellId: CellId, rowIndex: number) {
  let input = workbook.cellOf(cellId)?.input;
  return (input?.kind === 'formula' ? input.formula.references : []).some(
    (reference) =>
      reference.kind !== 'cell' && reference.sheetId === cellId.sheetId && (areaOfReference(workbook, reference)?.topRowIndex ?? rowIndex) < rowIndex,
  );
}
export function hasStrayCellsAroundTable(workbook: WorkbookReads, sheetId: SheetId, table: CellArea, sheet: SheetSummary) {
  let tableEndRowIndex = table.topRowIndex + table.rowCount;
  let tableEndColumnIndex = table.leftColumnIndex + table.columnCount;
  let fullHeight = {
    topRowIndex: 0,
    rowCount: sheet.rowCount,
  };
  let besideCells = [
    {
      ...fullHeight,
      leftColumnIndex: 0,
      columnCount: table.leftColumnIndex,
    },
    {
      ...fullHeight,
      leftColumnIndex: tableEndColumnIndex,
      columnCount: sheet.columnCount - tableEndColumnIndex,
    },
  ].flatMap((area) => workbook.filledCellsIn(sheetId, area));
  let belowCells = workbook.filledCellsIn(sheetId, {
    ...table,
    topRowIndex: tableEndRowIndex,
    rowCount: sheet.rowCount - tableEndRowIndex,
  });
  if (besideCells.length + belowCells.length > MOST_CELLS_LOOKED_AT) return true;
  let inputKindOf = (cellId: CellId) => workbook.cellOf(cellId)?.input.kind ?? 'formula';
  if (besideCells.some((cellId) => inputKindOf(cellId) !== 'formula')) return true;
  let countByRow = new Map<RowId, number>();
  for (let cellId of belowCells) {
    if (inputKindOf(cellId) === 'formula') {
      if (!formulaReadsRowsAbove(workbook, cellId, tableEndRowIndex)) return true;
      continue;
    }
    let count = (countByRow.get(cellId.rowId) ?? 0) + 1;
    if ((inputKindOf(cellId) !== 'text' && inputKindOf(cellId) !== 'richText') || count > 1) return true;
    countByRow.set(cellId.rowId, count);
  }
  return false;
}
export function isPlainRecordsTable(workbook: WorkbookReads, sheetId: SheetId, rows: CellArea) {
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  let columnIndexes = workbook.columnIndexesOnShowIn(sheetId, 0);
  let [leftColumnIndex, rightColumnIndex] = [Math.min(...columnIndexes), Math.max(...columnIndexes)];
  let isShortHeading = (columnIndex: number) => {
    let cellId = workbook.cellIdAt(sheetId, 0, columnIndex);
    let value = cellId === null ? null : cellValueOf(workbook.cellOnShowIn(cellId));
    return value?.kind === 'text' && value.value.length <= MAX_HEADING_TEXT_LENGTH;
  };
  if (sheet === undefined || rightColumnIndex - leftColumnIndex + 1 > columnIndexes.length || !columnIndexes.every(isShortHeading)) return false;
  if (rows.rowCount * columnIndexes.length > MOST_CELLS_LOOKED_AT) return false;
  if (columnIndexes.length > MAX_PLAIN_TABLE_COLUMNS) return false;
  let rowsArea = (topRowIndex: number, rowCount: number): CellArea => ({
    topRowIndex,
    rowCount,
    leftColumnIndex,
    columnCount: rightColumnIndex - leftColumnIndex + 1,
  });
  let rowsEndIndex = rows.topRowIndex + rows.rowCount;
  let tableEndIndex = rowsEndIndex;
  while (tableEndIndex < sheet.rowCount && workbook.filledCellsIn(sheetId, rowsArea(tableEndIndex, 1)).length > 0) tableEndIndex += 1;
  let tableArea = rowsArea(rows.topRowIndex, tableEndIndex - rows.topRowIndex);
  if (workbook.mergedAreasIn(sheetId, tableArea).length > 0) return false;
  for (let rowIndex = rowsEndIndex; rowIndex < tableEndIndex; rowIndex += 1)
    if (rowBelowBreaksTable(workbook, sheetId, rowsArea(rowIndex, 1), rows.topRowIndex, rowsEndIndex)) return false;
  if (hasStrayCellsAroundTable(workbook, sheetId, tableArea, sheet)) return false;
  let held = holdsOfEachColumn(workbook, sheetId, rowsArea(rows.topRowIndex, rows.rowCount));
  let rowIds = Array.from(
    {
      length: rows.rowCount,
    },
    (_, rowOffset) => workbook.cellIdAt(sheetId, rows.topRowIndex + rowOffset, leftColumnIndex),
  ).flatMap((cellId) => (cellId === null ? [] : [cellId.rowId]));
  let isFirstColumnPatchy = (held[0]?.filledCount ?? 0) < rows.rowCount;
  let isAnyTotalWord = held.some(
    ({ spelled }) => Array.from(spelled.keys()).some((text) => TOTAL_WORD_PATTERN.test(text)),
  );
  let firstColumnLabels = Array.from(held[0]?.spelled.keys() ?? [], (text) => text.trim());
  let isAnySubItem = firstColumnLabels.some((label) => SUB_ITEM_LABEL_PATTERN.test(label));
  let indentedLabels = Array.from(held[0]?.spelled.keys() ?? []).filter((text) => /^\s/.test(text));
  let isSomeIndented = indentedLabels.length > 0 && indentedLabels.length < firstColumnLabels.length;
  let isHeadingRepeated = columnIndexes
    .map((columnIndex) => {
      let cellId = workbook.cellIdAt(sheetId, 0, columnIndex);
      let value = cellId === null ? null : cellValueOf(workbook.cellOnShowIn(cellId));
      return value?.kind === 'text' ? value.value.trim().toLowerCase() : '';
    })
    .some((heading) => firstColumnLabels.includes(heading));
  let table: RecordsTable = {
    sheetId,
    rowIds,
    rows,
    columnIndexes,
    held,
  };
  return !(
    isFirstColumnPatchy ||
    isAnyTotalWord ||
    isAnySubItem ||
    isSomeIndented ||
    isHeadingRepeated ||
    hasSectionHeadingRows(workbook, table) ||
    hasSubtotalRows(table) ||
    isSummaryRow(workbook, table, rows.topRowIndex, rows.topRowIndex + 1) ||
    isSummaryRow(workbook, table, rowsEndIndex - 1, rowsEndIndex - 2)
  );
}
export function isOddFormulaBesideTable(workbook: WorkbookReads, cellId: CellId, rows: CellArea) {
  let cell = workbook.cellOf(cellId);
  if (cell?.input.kind !== 'formula') return false;
  return (
    /"|IFS?\(|FILTER\(/i.test(cell.formulaText ?? '') ||
    cell.input.formula.references.some((reference) => {
      let area = areaOfReference(workbook, reference);
      return (
        reference.kind === 'cell' ||
        reference.sheetId !== cellId.sheetId ||
        area === null ||
        area.topRowIndex !== rows.topRowIndex ||
        area.rowCount !== rows.rowCount
      );
    })
  );
}
export function isCellTiedToTableRows(workbook: WorkbookReads, cellId: CellId, rows: CellArea, sheet: SheetSummary) {
  let position = workbook.positionOfCell(cellId);
  if (position === null) return true;
  let { sheetId } = cellId;
  let tableColumnIndexes = new Set(workbook.columnIndexesOnShowIn(sheetId, 0));
  let rowsEndIndex = rows.topRowIndex + rows.rowCount;
  let othersInRow = workbook
    .filledCellsIn(sheetId, {
      topRowIndex: position.rowIndex,
      rowCount: 1,
      leftColumnIndex: 0,
      columnCount: sheet.columnCount,
    })
    .filter((otherCellId) => otherCellId.columnId !== cellId.columnId);
  if (position.rowIndex >= rows.topRowIndex && position.rowIndex < rowsEndIndex) {
    if (tableColumnIndexes.has(position.columnIndex)) return true;
    if (
      othersInRow
        .filter((otherCellId) => !tableColumnIndexes.has(workbook.positionOfCell(otherCellId)?.columnIndex ?? -1))
        .some((otherCellId) => cellValueOf(workbook.cellOnShowIn(otherCellId))?.kind === 'text')
    )
      return true;
    return workbook
      .filledCellsIn(sheetId, {
        ...rows,
        leftColumnIndex: position.columnIndex,
        columnCount: 1,
      })
      .some((columnCellId) => {
        let input = workbook.cellOf(columnCellId)?.input;
        let rowIndex = workbook.positionOfCell(columnCellId)?.rowIndex;
        return (input?.kind === 'formula' ? input.formula.references : []).some((reference) => {
          let area = reference.sheetId === sheetId ? areaOfReference(workbook, reference) : null;
          if (area === null || area.topRowIndex !== rowIndex) return false;
          return reference.kind === 'cell' || area.rowCount === 1;
        });
      });
  }
  return othersInRow.some((otherCellId) => isOddFormulaBesideTable(workbook, otherCellId, rows));
}
export function headedColumnsOfPlainTable(workbook: WorkbookReads, activeCell: CellId, isRowShown: (rowIndex: number) => boolean): HeadedColumn[] {
  let headedColumns = headedColumnsMatchingWord('', activeCell, workbook);
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === activeCell.sheetId);
  let sheetAsItStands = workbook.sheetAsItStands(activeCell.sheetId);
  let [firstColumn] = headedColumns;
  let rows = firstColumn === undefined || sheet === undefined ? null : parseA1Area(firstColumn.cells, sheet);
  if (rows === null || sheetAsItStands === null || sheet === undefined) return [];
  let sheetCache = plainTableCache.get(sheetAsItStands);
  if (sheetCache === undefined) plainTableCache.set(sheetAsItStands, (sheetCache = new Map<string, boolean>()));
  let rowsKey = [rows.topRowIndex, rows.rowCount].join();
  let isPlainTable = sheetCache.get(rowsKey);
  if (isPlainTable === undefined) sheetCache.set(rowsKey, (isPlainTable = isPlainRecordsTable(workbook, activeCell.sheetId, rows)));
  if (!isPlainTable || isCellTiedToTableRows(workbook, activeCell, rows, sheet)) return [];
  for (let rowOffset = 0; rowOffset < rows.rowCount; rowOffset += 1) if (!isRowShown(rows.topRowIndex + rowOffset)) return [];
  let rowsEndIndex = rows.topRowIndex + rows.rowCount;
  let fitCache = wordsColumnFitCache.get(sheetAsItStands);
  if (fitCache === undefined) wordsColumnFitCache.set(sheetAsItStands, (fitCache = new Map<string, boolean>()));
  let isWordsColumnFit = (cellsText: string) => {
    let isFit = fitCache.get(cellsText);
    if (isFit !== undefined) return isFit;
    let area = parseA1Area(cellsText, sheet);
    isFit =
      area !== null &&
      holdsOfArea(workbook, activeCell.sheetId, area).filledCount * 2 >= rows.rowCount &&
      workbook
        .filledCellsIn(activeCell.sheetId, {
          ...area,
          topRowIndex: rowsEndIndex,
          rowCount: sheet.rowCount - rowsEndIndex,
        })
        .every((cellId) => workbook.cellOf(cellId)?.input.kind === 'formula');
    fitCache.set(cellsText, isFit);
    return isFit;
  };
  return headedColumns.filter(({ cells }) => isWordsColumnFit(cells));
}
export const SUMMARY_LABEL_PATTERN =
  /^(?:grand |sub|over)?(?:totals?|all|sum|average|avg|mean|median|count|min|max|overall|combined|target|goal|budget|forecast|plan|projected|projection|estimate|prior|previous|last year|benchmark|industry|best|worst|ytd|cumulative|running|%|change|growth|variance|difference)(?:$|[^\p{L}])/iu;
export const REFERENCE_LABEL_PATTERN =
  /(?:^|[^\p{L}])(?:est|estimated?|forecast|proj|projected|expected|planned|target|goal|budget|quota|par|possible|out of|max|maximum|min|minimum|passing|pass mark|limit|cap|capacity|allowance|spec|standard|baseline|benchmark|threshold|required|worth|weights?|avg|average|mean|median|typical|ideal|example|sample|template|e\.g|tbd|n\/a)(?:$|[^\p{L}])/iu;
export const SUB_ITEM_LABEL_PATTERN = /^(?:[-–—•·]\s|(?:of which|thereof|incl\.?|including)(?:$|[^\p{L}]))/iu;
export const TOTAL_WORD_PATTERN = /(?:^|[^\p{L}])(?:sub-?)?(?:totals?|tot|sum)(?:$|[^\p{L}])|Σ/iu;
export const MAX_HEADING_TEXT_LENGTH = 100;
export const MAX_PLAIN_TABLE_COLUMNS = 40;
export const MIN_NUMBERS_FOR_SUMMARY_ROW = 3;
export const isNearlyEqualAsShown = (shown: number, value: number): boolean =>
  Math.abs(value - shown) <= 0.5000001 / 10 ** (String(shown).split('.')[1]?.length ?? 0);
/** Whether the rows under a sheet's headings read as a plain records table, by the rows' top and count. */
export const plainTableCache = new WeakMap<SheetRead, Map<string, boolean>>();
/** Whether a headed column fits words to be read against, by its cells in A1 terms. */
export const wordsColumnFitCache = new WeakMap<SheetRead, Map<string, boolean>>();
