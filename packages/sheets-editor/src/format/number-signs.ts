import type { DecimalSignName, GroupSignName, SizesOfGroupsName } from '@open-artifact/sheets-core';
import type { SignsOfNumbers } from '../model/workbook.ts';
export function groupSeparatorPattern(decimalSign: DecimalSignName): RegExp {
  let groupChars = Object.values(GROUP_SIGN_CHARS)
    .filter((char) => char !== DECIMAL_SIGN_CHARS[decimalSign])
    .join('');
  return new RegExp(`(?<=\\d)[${groupChars}](?=(?:\\d{2}[${groupChars}])*\\d{3}(?!\\d))`, 'g');
}
export function formatNumberWithSigns(
  number: number,
  { decimalSign, groupSign, sizesOfGroups }: SignsOfNumbers,
): string {
  let [wholePart = '', fractionPart] = plainNumberFormatter.format(Math.abs(number)).split('.');
  let groupSize = GROUP_SIZES[sizesOfGroups];
  let groups = [wholePart.slice(-3)];
  for (let end = wholePart.length - 3; end > 0; end -= groupSize) groups.unshift(wholePart.slice(Math.max(0, end - groupSize), end));
  let grouped = groups.join(GROUP_SIGN_CHARS[groupSign]);
  let text = fractionPart === undefined ? grouped : `${grouped}${DECIMAL_SIGN_CHARS[decimalSign]}${fractionPart}`;
  return number < 0 ? `-${text}` : text;
}
export function parsePlainNumber(text: string, decimalSign: DecimalSignName): number | null {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === ' ') start += 1;
  while (end > start && text[end - 1] === ' ') end -= 1;
  let trimmed = text.slice(start, end);
  if (!PLAIN_NUMBER_PATTERNS[decimalSign].test(trimmed)) return null;
  let number = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  return number === 0 ? 0 : number;
}
export const EN_US_LOCALE = 'en-US';
export const formulaArgumentSeparator = (decimalSign: DecimalSignName): ';' | ',' => (decimalSign === 'comma' ? ';' : ',');
export const arrayColumnSeparator = (decimalSign: DecimalSignName): '\\' | ',' => (decimalSign === 'comma' ? '\\' : ',');
export const DECIMAL_SIGN_CHARS: Record<DecimalSignName, string> = {
  point: '.',
  comma: ',',
};
export const GROUP_SIGN_CHARS: Record<GroupSignName, string> = {
  comma: ',',
  point: '.',
  noBreakSpace: ' ',
  narrowNoBreakSpace: ' ',
  apostrophe: "'",
};
export const GROUP_SIZES: Record<SizesOfGroupsName, number> = {
  threes: 3,
  threeAndThenTwos: 2,
};
export const withDecimalSign = (text: string, decimalSign: DecimalSignName): string => text.replace('.', DECIMAL_SIGN_CHARS[decimalSign]);
export const GROUP_SEPARATOR_PATTERNS: Record<DecimalSignName, RegExp> = {
  point: groupSeparatorPattern('point'),
  comma: groupSeparatorPattern('comma'),
};
export const stripGroupSeparators = (text: string, decimalSign: DecimalSignName): string =>
  text.replaceAll(GROUP_SEPARATOR_PATTERNS[decimalSign], '');
export const normalizeNoBreakSpaces = (text: string): string => text.replaceAll(/[\u00a0\u202f]/g, ' ');
export const plainNumberFormatter = new Intl.NumberFormat('en-US', {
  useGrouping: false,
  maximumSignificantDigits: 15,
});
export const PLAIN_NUMBER_PATTERNS: Record<DecimalSignName, RegExp> = {
  point: /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/,
  comma: /^[+-]?(?:\d+(?:,\d*)?|,\d+)(?:[eE][+-]?\d+)?$/,
};
