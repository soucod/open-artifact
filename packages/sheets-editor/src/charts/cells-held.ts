import { shownCellText } from '../format/shown-text.ts';
import { MAX_FIND_SHOWN_CHARACTERS } from '../ui/find.ts';
import { pickTellingRowsForAgent } from './chart-code-ask.ts';
import { nonEmptyValueOfCell, DATE_TIME_FORMAT_KINDS } from '../selection/figures.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { IdRun, SheetId } from '@open-artifact/sheets-core';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { CellArea } from '../selection/model.ts';
import type { CellsToldToAgent, RowToldToAgent } from './chart-code-ask.ts';

/** Lines held by the runs of their ids, so they are found again however lines come and go; and how many there were. */
export interface HeldRunsOfLines {
  runs: IdRun[];
  count: number;
}
/** Cells of a sheet held by the ids of their rows and columns. */
export interface CellsHeld {
  sheetId: SheetId;
  rows: HeldRunsOfLines;
  columns: HeldRunsOfLines;
}
export function heldAreaOf(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, leftColumnIndex, rowCount, columnCount }: CellArea,
): CellsHeld | null {
  let lines = reads.linesOf(sheetId);
  if (lines === null) return null;
  let heldRows = heldRunsOfLines(lines.rows, topRowIndex, rowCount);
  let heldColumns = heldRunsOfLines(lines.columns, leftColumnIndex, columnCount);
  return heldRows === null || heldColumns === null
    ? null
    : {
        sheetId,
        rows: heldRows,
        columns: heldColumns,
      };
}
export function stretchOfHeldRuns(lines: LineIndex, { runs, count }: HeldRunsOfLines, allowsGaps: boolean): LineSpan | null {
  let stretches = runs.flatMap((run) => lines.stretchesOf(run));
  let firstIndex = stretches.reduce((lowest, stretch) => Math.min(lowest, stretch.firstIndex), 1 / 0);
  let endIndex = stretches.reduce(
    (highest, stretch) => Math.max(highest, stretch.firstIndex + stretch.count),
    0,
  );
  let isCountMatched = stretches.reduce((total, stretch) => total + stretch.count, 0) === count;
  let isWithoutGaps = stretches.every((stretch, index) => {
    let previous = stretches[index - 1];
    return previous === undefined || previous.firstIndex + previous.count === stretch.firstIndex;
  });
  return isCountMatched && endIndex - firstIndex === count && (allowsGaps || isWithoutGaps)
    ? {
        firstIndex,
        count,
      }
    : null;
}
export function areaOfHeld(reads: WorkbookReads, { sheetId, rows, columns }: CellsHeld): CellArea | null {
  let lines = reads.linesOf(sheetId);
  let rowStretch = lines === null ? null : stretchOfHeldRuns(lines.rows, rows, true);
  let columnStretch = lines === null ? null : stretchOfHeldRuns(lines.columns, columns, false);
  return rowStretch === null || columnStretch === null
    ? null
    : {
        topRowIndex: rowStretch.firstIndex,
        leftColumnIndex: columnStretch.firstIndex,
        rowCount: rowStretch.count,
        columnCount: columnStretch.count,
      };
}
export function sampleOfAreaForChart(
  reads: WorkbookReads,
  sheetId: SheetId,
  area: CellArea,
  [firstRowsWanted, maxColumns]: readonly [number, number],
): CellsToldToAgent | null {
  let shownArea = reads.areaOnShowIn(sheetId, area);
  if (shownArea === null) return null;
  let rowCount = shownArea.topRowIndex + shownArea.rowCount - area.topRowIndex;
  let columnCount = shownArea.leftColumnIndex + shownArea.columnCount - area.leftColumnIndex;
  let textAt = (rowOffset: number, columnOffset: number) => {
    let cellId = reads.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex + columnOffset);
    let cell = cellId === null ? null : reads.cellOnShowIn(cellId);
    return cell === null ? '' : shownCellText(cell, MAX_FIND_SHOWN_CHARACTERS, reads.decimalSign).text;
  };
  let textsOfRows = (firstRow: number, count: number) =>
    Array.from(
      {
        length: count,
      },
      (_row, index) =>
        Array.from(
          {
            length: Math.min(columnCount, maxColumns),
          },
          (_cell, columnOffset) => textAt(firstRow + index, columnOffset),
        ),
    );
  let { last: lastRows, withGaps: rowsWithGaps } = pickTellingRowsForAgent(
    [rowCount, columnCount],
    (rowOffset, columnOffset) => {
      let cellId = reads.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex + columnOffset);
      let value = nonEmptyValueOfCell(reads, cellId);
      if (cellId === null || value === null) return 'nothing';
      let isPickedFromList = DATE_TIME_FORMAT_KINDS.has(numberFormatOfCell(reads, cellId).kind);
      return value.kind === 'number' && !isPickedFromList ? 'number' : 'somethingElse';
    },
  );
  let rowSample = (rowOffset: number): RowToldToAgent => ({
    row: rowOffset + 1,
    texts: textsOfRows(rowOffset, 1).flat(),
  });
  return {
    rowCount,
    firstRows: textsOfRows(0, Math.min(rowCount, firstRowsWanted)),
    lastRows: lastRows.map(rowSample),
    rowsWithGaps: rowsWithGaps.map(rowSample),
  };
}
export const heldRunsOfLines = (lines: LineIndex, firstIndex: number, count: number): HeldRunsOfLines | null =>
  firstIndex + count > lines.count
    ? null
    : {
        runs: lines.runsIn({
          firstIndex,
          count,
        }),
        count,
      };
export const isSingleCellSample = ({ rowCount, firstRows }: Pick<CellsToldToAgent, 'rowCount' | 'firstRows'>): boolean =>
  rowCount === 1 && firstRows[0]?.length === 1;
