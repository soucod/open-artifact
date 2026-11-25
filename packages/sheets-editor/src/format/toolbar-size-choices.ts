import type { VerticalAlignment } from '@open-artifact/sheets-core';
export function fontSizesMatchingTyped(typed: string): number[] {
  let digits = /^0*(?<digits>[1-9]\d*)\s*(?:pt?)?$/iu.exec(typed.normalize('NFKC').trim())?.groups?.digits;
  return digits === undefined ? [] : FONT_SIZES_TYPEABLE.filter((size) => String(size).startsWith(digits));
}
export const FONT_SIZE_CHOICES = [6, 7, 8, 9, 10, 11, 12, 14, 18, 24, 36];
export const SMALLEST_FONT_SIZE = 6;
export const LARGEST_FONT_SIZE = 96;
export const FONT_SIZES_TYPEABLE = Array.from(
  {
    length: 91,
  },
  (_, index) => 6 + index,
);
export const VERTICAL_ALIGN_CHOICES: VerticalAlignment[] = ['top', 'center', 'bottom'];
