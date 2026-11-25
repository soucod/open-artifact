import type { DecimalSignName, ShownColor, ValueContents } from '@open-artifact/sheets-core';
import type { CellOnShow } from '../model/workbook.ts';
import type { ShownCell } from '../grid/formulas-shown.ts';
import { booleanText, sanitizeTypedCellInput } from '../model/cell-text.ts';
import { withDecimalSign } from './number-signs.ts';
import { generalNumberText } from './general-numbers.ts';
import { cellValueOf } from '../model/cell-values.ts';
/** The text a cell shows, and the color its number format gives that text. */
export interface ShownCellText {
  text: string;
  textColor: ShownColor | null;
}
export function trimTrailingNewlines(text: string): string {
  let end = text.length;
  while (
    text[end - 1] ===
    `
`
  )
    end -= 1;
  return text.slice(0, end);
}
export function toPrecisionText(number: number, precision: number): string {
  let rounded = Number(number.toPrecision(precision));
  return String(Number.isFinite(rounded) ? rounded : number).toUpperCase();
}
export function generalValueText(value: ValueContents | null, maxChars: number, decimalSign: DecimalSignName): string {
  switch (value?.kind) {
    case undefined:
      return '';
    case 'text':
    case 'error':
      return value.value;
    case 'boolean':
      return booleanText(value.value);
    case 'number':
      return withDecimalSign(generalNumberText(value.value, Math.min(maxChars, GENERAL_FORMAT_MAX_CHARS)), decimalSign);
  }
}
export function shownCellText(
  cell: ShownCell | null,
  maxChars: number,
  decimalSign: DecimalSignName,
  overflows: (text: string) => boolean = () => false,
): ShownCellText {
  let shown = cell?.shown;
  if (shown?.kind === 'text')
    return {
      text: shown.text,
      textColor: shown.textColor,
    };
  let charLimit = Math.floor(maxChars);
  if (shown !== undefined && shown.reason !== 'notPrintedYet') {
    let fillCount = Math.max(1, Math.min(charLimit, GENERAL_FORMAT_MAX_CHARS));
    return {
      text: OVERFLOW_FILL_CHAR.repeat(fillCount),
      textColor: null,
    };
  }
  let value = cellValueOf(cell);
  let text = generalValueText(value, charLimit, decimalSign);
  if (value?.kind !== 'number')
    return {
      text,
      textColor: null,
    };
  while (text.length <= charLimit && overflows(text)) {
    charLimit = text.length - 1;
    text = generalValueText(value, charLimit, decimalSign);
  }
  return {
    text,
    textColor: null,
  };
}
export function isNegativeShownByColorAlone(cell: ShownCell | null): boolean {
  let value = cellValueOf(cell);
  let shown = cell?.shown;
  return (
    shown?.kind === 'text' &&
    shown.textColor !== null &&
    value?.kind === 'number' &&
    value.value < 0 &&
    /\d/.test(shown.text) &&
    !NEGATIVE_SIGN_PATTERN.test(shown.text)
  );
}
export const normalizeLineBreaks = (text: string): string =>
  text.replaceAll(
    /\r\n?/g,
    `
`,
  );
export const cleanEnteredCellText = (text: string): string => sanitizeTypedCellInput(trimTrailingNewlines(text));
export const flattenEnteredText = (text: string): string =>
  trimTrailingNewlines(text).replaceAll(
    `
`,
    ' ',
  );
export const toExponentialText = (number: number, fractionDigits: number): string =>
  number
    .toExponential(fractionDigits)
    .toUpperCase()
    .replace(/\.?0*E/, 'E');
export const GENERAL_FORMAT_MAX_CHARS = 11;
export const MAX_EXPONENT_FRACTION_DIGITS = 5;
export const OVERFLOW_FILL_CHAR = '#';
export const isCellShownBlank = (cell: CellOnShow | null): boolean => shownCellText(cell, 1 / 0, 'point').text.trim() === '';
export const NEGATIVE_SIGN_PATTERN = /(?:^|[^Ee])[-\u2212(]/;
export { MAX_SIGNIFICANT_DIGITS } from './shown-text-values.ts';
