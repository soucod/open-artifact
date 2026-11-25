/**
 * Ids and places as the engine names them. A workbook names its sheets, rows
 * and columns by id, never by position, so that edits made on different
 * revisions land on the same cells.
 *
 * A sheet id is `sht_<code>.<n>`; a row id `row_<code>.<n>`, a column id
 * `col_<code>.<n>`, where `<code>` is the `newIdCode` of the edit that made it
 * (8 to 16 small letters and digits) and `<n>` a number without leading zeros.
 */

/** A sheet's id: `sht_<code>.<n>`. */
export type SheetId = string;
/** A row's id: `row_<code>.<n>`. */
export type RowId = string;
/** A column's id: `col_<code>.<n>`. */
export type ColumnId = string;

/**
 * A run of row (or column) ids: `base.first`, `base.(first+1)`, …,
 * `base.(first+count-1)`. `count` is at least 1.
 */
export interface IdRun {
  /** `row_<code>` or `col_<code>`. */
  base: string;
  first: number;
  count: number;
}

/**
 * The ids of one base as runs of `[first, count]`, rising and apart. Operations
 * write a sheet's rows so (each base once) when there are many runs of them.
 */
export interface RunsOfABase {
  base: string;
  runs: [first: number, count: number][];
}

/** A cell by its row and column ids. */
export interface CellAt {
  r: RowId;
  c: ColumnId;
}

/** A range by its corners, as written (they need not be in order). */
export interface RangeCorners {
  topLeft: CellAt;
  bottomRight: CellAt;
}

/** A range on a named sheet. */
export interface RangeOnASheet extends RangeCorners {
  sheetId: SheetId;
}

/**
 * Cells as edits and reads of a selection name them: rows (by runs, in the
 * order given), from one column to another (either may be the left one).
 */
export interface CellBlock {
  sheetId: SheetId;
  rows: IdRun[];
  oneColumn: ColumnId;
  otherColumn: ColumnId;
}

/**
 * The place an edit changed, as the page is told it: the sheet, the cells in it
 * (`null`: the sheet as a whole, or a sheet gone), and the placement that is all
 * the place is, when one is. `null` where the place is nowhere to show.
 */
export interface PlaceChanged {
  sheetId: SheetId;
  cells: RangeCorners | null;
  placementId?: string;
}
