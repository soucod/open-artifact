import type { CellControl, CellFormat, ValueContents } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import { cellValueOf } from '../model/cell-values.ts';
export const isCheckboxFormat = ({ cellControl }: { cellControl?: CellControl | null }): boolean => cellControl?.kind === 'checkbox';
export const booleanOfValue = (value: ValueContents | null): boolean | null => (value?.kind === 'boolean' ? value.value : null);
export const isCheckboxCell = (reads: WorkbookReads, cellId: CellId): boolean =>
  isCheckboxFormat(reads.formatOf(cellId)) && cellValueOf(reads.cellOf(cellId))?.kind === 'boolean';
export const isShownCheckboxCell = (reads: WorkbookReads, cellId: CellId): boolean =>
  isCheckboxFormat(reads.formatOf(cellId)) && cellValueOf(reads.cellOnShowIn(cellId))?.kind === 'boolean';
export const CHECKBOX_FORMAT = {
  cellControl: {
    kind: 'checkbox',
  },
} satisfies CellFormat;
