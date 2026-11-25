import type { CellContents, DecimalSignName, ListLine, Mark, Person, ValueContents } from '@open-artifact/sheets-core';
import type { CellOnShow } from './workbook.ts';
import type { ShownCell } from '../grid/formulas-shown.ts';
import { shownCellText } from '../format/shown-text.ts';
import { TEXT_PREFIX_QUOTE, booleanText, textAsTypedInput, sanitizeCellText } from './cell-text.ts';
import { withDecimalSign } from '../format/number-signs.ts';
/** A line of a rich text's lists, and the number it shows (`null`: none). */
export interface LineOfAList {
  list: ListLine;
  number: number | null;
}
/** Whether a rich text is bold, and whether it is italic, anywhere in it. */
export interface BoldAndItalic {
  bold: boolean;
  italic: boolean;
}
export function dropdownOptionLabel(cell: CellOnShow): string {
  if (cell.value?.kind !== 'text') throw Error('a dropdown option was read without its label');
  return cell.value.value;
}
export function usersOfCell(cell: ShownCell | null): readonly Person[] {
  if (cell === null || !('input' in cell)) return NO_CELL_USERS;
  if (cell.input.kind === 'user') return [cell.input];
  return cell.input.kind === 'users' ? cell.input.users : NO_CELL_USERS;
}
export function peopleLabelOfCell(cell: CellOnShow): string {
  if (cell.value?.kind !== 'text') throw Error('people were read without their labels');
  return cell.value.value;
}
export function richTextPlainText(cell: CellOnShow): string {
  if (cell.value?.kind !== 'text') throw Error('a rich text was read without its plain text');
  return cell.value.value;
}
export function cellPlainText(cell: CellContents | null): string | null {
  if (cell?.input.kind === 'text') return cell.input.value;
  return cell?.input.kind === 'richText' ? richTextPlainText(cell) : null;
}
export function listLinesOfCell(cell: CellContents | null): LineOfAList[] {
  if (cell?.input.kind !== 'richText') return NO_LIST_LINES;
  let cached = listLinesOfCellCache.get(cell);
  if (cached !== void 0) return cached;
  let { paragraphs } = cell.input;
  let lines =
    shownCellText(cell, 1 / 0, 'point').text === richTextPlainText(cell) &&
    paragraphs.some(({ list }) => list.kind !== 'none')
      ? paragraphs.map(
          ({ list }, index) => ({
            list,
            number: cell.numbersOfListLines?.[index] ?? null,
          }),
        )
      : NO_LIST_LINES;
  return (listLinesOfCellCache.set(cell, lines), lines);
}
export function richTextBoldItalic(cell: CellOnShow | null): BoldAndItalic {
  let marks = richTextMarksOfCell(cell);
  return {
    bold: marks.includes('bold'),
    italic: marks.includes('italic'),
  };
}
export function cellInputText(cell: CellContents | null, decimalSign: DecimalSignName): string {
  let quotePrefix = cell?.textIsEditedAfterTheMark === true ? TEXT_PREFIX_QUOTE : '';
  switch (cell?.input.kind) {
    case undefined:
      return '';
    case 'number':
      return cell.numberIsEditedAs ?? withDecimalSign(String(cell.input.value), decimalSign);
    case 'text':
      return quotePrefix + cell.input.value;
    case 'dropdownOption':
      return quotePrefix + dropdownOptionLabel(cell);
    case 'user':
    case 'users':
      return quotePrefix + peopleLabelOfCell(cell);
    case 'richText':
      return quotePrefix + richTextPlainText(cell);
    case 'boolean':
      return booleanText(cell.input.value);
    case 'formula':
      return formulaTextOf(cell);
  }
}
export function formulaTextOf({ formulaText }: Pick<CellContents, 'formulaText'>): string {
  if (formulaText === undefined) throw Error('a formula was read without its text');
  return formulaText;
}
export function cellInputKey(cell: CellContents | null): string {
  if (cell?.input.kind === 'dropdownOption') return cell.input.optionId + cell.input.label;
  if (cell?.input.kind === 'richText') return JSON.stringify(cell.input.paragraphs);
  let users = usersOfCell(cell);
  return users.length === 0 ? cellInputText(cell, 'point') : JSON.stringify(users);
}
export function cellTextAsTyped(cell: CellOnShow | null, decimalSign: DecimalSignName): string {
  if (cell !== null && 'input' in cell && cell.input.kind === 'dropdownOption') return textAsTypedInput(dropdownOptionLabel(cell), decimalSign);
  return cell === null || 'input' in cell ? cellInputText(cell, decimalSign) : valueAsTypedText(cell.value, decimalSign);
}
export function valueAsTypedText(value: ValueContents, decimalSign: DecimalSignName): string {
  switch (value.kind) {
    case 'number':
      return withDecimalSign(String(value.value).toUpperCase(), decimalSign);
    case 'text':
      return textAsTypedInput(sanitizeCellText(value.value), decimalSign);
    case 'boolean':
      return booleanText(value.value);
    case 'error':
      return value.value;
  }
}
export function formulaResultAsTypedText(cell: CellOnShow | null, decimalSign: DecimalSignName): string | null {
  if (cell === null || ('input' in cell && cell.input.kind !== 'formula')) return null;
  return cell.value === undefined ? '' : valueAsTypedText(cell.value, decimalSign);
}
export function cellValueOf(cell: ShownCell | null): ValueContents | null {
  if (cell === null) return null;
  if (!('input' in cell)) return cell.value;
  if (cell.input.kind === 'number' || cell.input.kind === 'text' || cell.input.kind === 'boolean') return cell.input;
  if (cell.value === undefined && cell.input.kind !== 'formula') throw Error(`a ${cell.input.kind} was read without its value`);
  return cell.value ?? null;
}
export const NO_CELL_USERS: Person[] = [];
export const levelInList = (list: ListLine): number | null => (list.kind === 'none' ? null : list.level);
export const NO_LIST_LINES: LineOfAList[] = [];
export const listLinesOfCellCache = new WeakMap<CellContents, LineOfAList[]>();
export const richTextMarksOfCell = (cell: CellOnShow | null): Mark[] =>
  cell !== null && 'input' in cell && cell.input.kind === 'richText'
    ? cell.input.paragraphs.flatMap(({ runs }) => runs.flatMap(({ marks }) => marks))
    : [];
