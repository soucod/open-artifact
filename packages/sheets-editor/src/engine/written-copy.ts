import type { CellsToCopyAnswer, RowId, SheetId } from '@open-artifact/sheets-core';
import type { CellArea } from '../selection/model.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { SyncedWorkbook } from '../store/workbook-sync.ts';
import type { ColumnsToRead } from './core-reads.ts';
import { buildClipboardContentForCopy, indexesOfRuns, type AreaToCopy, type ClipboardContent, type CopyCorners } from '../state/controller.ts';
import { inWords } from './workbook-host.ts';

/** A copy as the workbook's worker writes it, and what writing its look threw (`null`: nothing). */
export interface CopyWritten {
  contents: ClipboardContent;
  whatTheLookThrew: string | null;
}

/** Writes a copy of the cells between two corners, reading only the rows it takes; `null` when it cannot. */
export type WriteCopy = (reads: WorkbookReads, readsWithCellsIn: SyncedWorkbook['readsWithCellsIn'], corners: CopyCorners) => CopyWritten | null;

/**
 * The rows a copy reads: those of the cells copied (counted past the rows left out) and the top rows of the merged
 * areas it meets, between its leftmost column (a merged area's, when one starts further left) and its last.
 */
export function rowsToReadForCopy(
  reads: WorkbookReads,
  { sheetId, area, rowsLeftOut }: AreaToCopy,
  { cells, columnCount }: CellsToCopyAnswer,
): [SheetId, RowId[], ColumnsToRead] | null {
  let rowIndexesLeftOut = indexesOfRuns(rowsLeftOut);
  let rowIndexes = new Set<number>();
  let [rowIndex, row] = [area.topRowIndex - 1, -1];
  for (let { row: rowOfCell } of cells) {
    while (row < rowOfCell) if (((rowIndex += 1), !rowIndexesLeftOut.has(rowIndex))) row += 1;
    rowIndexes.add(rowIndex);
  }
  let { leftColumnIndex } = area;
  for (let mergedArea of reads.mergedAreasIn(sheetId, area))
    rowIndexes.add(mergedArea.topRowIndex), (leftColumnIndex = Math.min(leftColumnIndex, mergedArea.leftColumnIndex));
  let lines = reads.linesOf(sheetId);
  let oneColumn = lines?.columns.idAt(leftColumnIndex) ?? null;
  let otherColumn = lines?.columns.idAt(area.leftColumnIndex + Math.max(0, columnCount - 1)) ?? null;
  if (lines === null || oneColumn === null || otherColumn === null) return null;
  let rowIds = [...rowIndexes].flatMap((index) => lines.rows.idAt(index) ?? []);
  return [
    sheetId,
    rowIds,
    {
      oneColumn,
      otherColumn,
    },
  ];
}

/**
 * Writes a copy on the workbook's worker: the engine says which cells it takes, the rows of those cells are read
 * with their cells, and the copy is written from them. When writing its look throws, the copy is written without it.
 */
export const writeCopy: WriteCopy = (reads, readsWithCellsIn, corners) => {
  let [oneCorner, otherCorner, rowsOutOfView] = corners;
  let [onePosition, otherPosition] = [reads.positionOfCell(oneCorner), reads.positionOfCell(otherCorner)];
  let rowLines = reads.linesOf(oneCorner.sheetId)?.rows;
  if (onePosition === null || otherPosition === null || rowLines === undefined) return null;
  let area: CellArea = {
    topRowIndex: Math.min(onePosition.rowIndex, otherPosition.rowIndex),
    leftColumnIndex: Math.min(onePosition.columnIndex, otherPosition.columnIndex),
    rowCount: Math.abs(otherPosition.rowIndex - onePosition.rowIndex) + 1,
    columnCount: Math.abs(otherPosition.columnIndex - onePosition.columnIndex) + 1,
  };
  let rowsLeftOut = rowsOutOfView.flatMap((run) => rowLines.stretchesOf(run));
  let toCopy: AreaToCopy = {
    sheetId: oneCorner.sheetId,
    area,
    rowsLeftOut,
  };
  let cellsToCopy = reads.cellsToCopy(...corners);
  if (cellsToCopy === null) return null;
  let rowsToRead = rowsToReadForCopy(reads, toCopy, cellsToCopy);
  let readsOfRows = rowsToRead === null ? null : readsWithCellsIn(...rowsToRead);
  if (readsOfRows === null) return null;
  let write = (trimToContent: boolean) =>
    buildClipboardContentForCopy(
      {
        ...readsOfRows,
        cellsToCopy: () => cellsToCopy,
      },
      toCopy,
      corners,
      trimToContent,
    );
  try {
    return {
      contents: write(true),
      whatTheLookThrew: null,
    };
  } catch (error: unknown) {
    try {
      return {
        contents: write(false),
        whatTheLookThrew: inWords(error),
      };
    } catch {
      return null;
    }
  }
};
