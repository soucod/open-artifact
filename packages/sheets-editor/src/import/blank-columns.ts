import { dataLineNumbers, importTextAt } from './column-readings.ts';
import type { ImportLineChoice } from './column-readings.ts';
import type { ImportFile } from '../state/initial-state.ts';
export function blankColumnsOf(file: ImportFile, plan: ImportLineChoice) {
  let { headerLine, linesLeftOut } = plan;
  let byLines = blankColumnsCache.get(file) ?? new Map<string, number[]>();
  let key = `${headerLine} ${linesLeftOut.join()}`;
  let cached = byLines.get(key);
  if (cached !== undefined) return cached;
  let blankColumns = new Set(
    Array.from(
      {
        length: file.columnCount,
      },
      (_, index) => index,
    ),
  );
  for (let lineNumber of [...(headerLine === null ? [] : [headerLine]), ...dataLineNumbers(file, plan)]) {
    if (blankColumns.size === 0) break;
    for (let columnIndex of blankColumns) if (!isBlankImportCell(importTextAt(file, lineNumber, columnIndex))) blankColumns.delete(columnIndex);
  }
  let blankColumnIndexes = [...blankColumns];
  for (let oldKey of [...byLines.keys()].slice(0, Math.max(0, byLines.size + 1 - BLANK_COLUMNS_CACHE_SIZE))) byLines.delete(oldKey);
  blankColumnsCache.set(file, byLines.set(key, blankColumnIndexes));
  return blankColumnIndexes;
}
export const isBlankImportCell = (text: string) => text.trim() === '';
/** The blank columns of a file, by the lines a plan reads (`${headerLine} ${linesLeftOut}`). */
export const blankColumnsCache = new WeakMap<ImportFile, Map<string, number[]>>();
export const BLANK_COLUMNS_CACHE_SIZE = 4;
