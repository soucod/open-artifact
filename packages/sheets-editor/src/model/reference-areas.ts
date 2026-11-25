import type { CellPoint, ColumnPoint, Reference, RowPoint } from '@open-artifact/sheets-core';
import type { WorkbookReads } from './workbook.ts';
import type { CellArea } from '../selection/model.ts';
import { areaAsSeen } from './a1-references.ts';
export function areaOfReference(reads: WorkbookReads, reference: Reference): CellArea | null {
  let { sheetId } = reference;
  let sheet = reads.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined) return null;
  let ownRowOrder = sheet.ownRowOrder;
  let rowOf = ({ r: rowId }: RowPoint | CellPoint): number | null => (ownRowOrder === null ? reads.rowIndexOf(sheetId, rowId) : ownRowOrder.stored.indexOf(rowId));
  let columnOf = ({ c }: ColumnPoint | CellPoint): number | null => reads.columnIndexOf(sheetId, c);
  let rows: (number | null)[];
  let columns: (number | null)[];
  switch (reference.kind) {
    case 'cell':
      [rows, columns] = [[rowOf(reference.cell)], [columnOf(reference.cell)]];
      break;
    case 'range': {
      let corners = [reference.topLeft, reference.bottomRight];
      [rows, columns] = [corners.map(rowOf), corners.map(columnOf)];
      break;
    }
    case 'columns':
      rows = [reference.top === null ? 0 : rowOf(reference.top), sheet.rowCount - 1];
      columns = [reference.left, reference.right].map(columnOf);
      break;
    case 'rows':
      rows = [reference.top, reference.bottom].map(rowOf);
      columns = [reference.left === null ? 0 : columnOf(reference.left), sheet.columnCount - 1];
      break;
  }
  if (!isNoneMissing(rows) || !isNoneMissing(columns)) return null;
  let [topRow, leftColumn] = [Math.min(...rows), Math.min(...columns)];
  let areaAsStored = {
    topRowIndex: topRow,
    leftColumnIndex: leftColumn,
    rowCount: Math.max(...rows) - topRow + 1,
    columnCount: Math.max(...columns) - leftColumn + 1,
  };
  return areaAsSeen(areaAsStored, ownRowOrder);
}
export const isNoneMissing = (indexes: readonly (number | null)[]): indexes is number[] => !indexes.includes(null);
