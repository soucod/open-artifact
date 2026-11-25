/**
 * Reads whose cells come apart from their JSON: the answer names blocks of
 * cells by index, and the blocks reach the caller's `take` (see
 * `EngineClient.requestWithCells`). Everything else in the answer is as the
 * plain read tells it.
 */

import type { ColumnId, RowId, SheetId } from './ids.ts';
import type { SheetLayoutContents, SpilledCell, WorkbookContents } from './reads.ts';

/** A block of cells, by the order this answer's blocks were taken in (from 0). */
export type CellBlockIndex = number;

/** A sheet as `readWorkbook` tells it, its cells in blocks. */
export interface SheetContentsWithCellsPacked extends SheetLayoutContents {
  cells: CellBlockIndex[];
}

/** The workbook as `readWorkbook` tells it, each sheet's cells in blocks. */
export interface WorkbookContentsWithCellsPacked extends Omit<WorkbookContents, 'kind' | 'sheets'> {
  kind: 'workbookContentsWithCellsPacked';
  sheets: SheetContentsWithCellsPacked[];
}

export interface ReadWorkbookWithCellsPackedRequest {
  kind: 'readWorkbookWithCellsPacked';
}

/**
 * Some cells of a sheet, in blocks: those in the rows named (`null`: every row)
 * and between two columns, either way round (`null`: every column).
 */
export interface ReadRowsWithCellsPackedRequest {
  kind: 'readRowsWithCellsPacked';
  sheetId: SheetId;
  /** Rows the sheet does not have are passed over. */
  rows: RowId[] | null;
  columns: [ColumnId, ColumnId] | { oneColumn: ColumnId; otherColumn: ColumnId } | null;
}

/** The cells read, in blocks, row by row, and what spills into them. */
export interface RowsWithCellsPackedAnswer {
  kind: 'rowsWithCellsPacked';
  cells: CellBlockIndex[];
  spilledCells?: SpilledCell[];
}

/** Each packed read's request and the answer it gets when it is not refused. */
export interface PackedReadKinds {
  readWorkbookWithCellsPacked: {
    request: ReadWorkbookWithCellsPackedRequest;
    answer: WorkbookContentsWithCellsPacked;
  };
  readRowsWithCellsPacked: { request: ReadRowsWithCellsPackedRequest; answer: RowsWithCellsPackedAnswer };
}

export type PackedReadKind = keyof PackedReadKinds;

export type PackedReadRequest = { [K in PackedReadKind]: PackedReadKinds[K]['request'] }[PackedReadKind];
