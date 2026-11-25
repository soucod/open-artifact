import { sanitizeCellText } from '../model/cell-text.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ImportDestination } from '../state/initial-state.ts';
export function truncateToCleanText(text: string, maxChars: number) {
  let cleaned = sanitizeCellText(text.slice(0, maxChars * 4).replace(/[\uD800-\uDBFF]$/, ''))
    .replaceAll(/\s+/g, ' ')
    .replaceAll(INVISIBLE_CHARACTER_PATTERN, '')
    .trim();
  return Array.from(cleaned).slice(0, maxChars).join('').trim();
}
export const dayMonthOrderOf = ({ dayTypedAs }: Pick<WorkbookReads, 'dayTypedAs'>) =>
  dayTypedAs('1/2/2000') === '2000-02-01' ? 'dayMonthYear' : 'monthDayYear';
export const MAX_BROUGHT_DOWN_DECIMAL_PLACES = 6;
export const MAX_IMPORT_QUESTIONS = 3;
export const NEW_SHEET_DESTINATION: Extract<ImportDestination, { kind: 'newSheet' }> = {
  kind: 'newSheet',
};
export const INVISIBLE_CHARACTER_PATTERN = /[\p{Cc}\p{Cf}]/gu;
