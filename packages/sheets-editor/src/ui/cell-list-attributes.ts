import type { ListLine } from '@open-artifact/sheets-core';
import { isListLevel } from '../editor/text-looks.ts';
import type { LineOfAList } from '../model/cell-values.ts';
export function romanNumeralOf(number: number): string {
  let [left, text] = [number, ''];
  for (let [worth, numeral] of ROMAN_NUMERALS)
    while (left >= worth) {
      text += numeral;
      left -= worth;
    }
  return text;
}
export function alphabeticNumeralOf(number: number): string {
  let [left, text] = [number, ''];
  while (left > 0) {
    text = String.fromCodePoint(97 + ((left - 1) % 26)) + text;
    left = Math.floor((left - 1) / 26);
  }
  return text;
}
export function listAttributesOf({ list, number }: LineOfAList): ListAttributes {
  if (list.kind === 'none') return {};
  return {
    [LIST_ATTRIBUTE]: list.kind,
    [LIST_LEVEL_ATTRIBUTE]: String(list.level),
    ...(number !== null && {
      [LIST_NUMBER_ATTRIBUTE]: listNumberText(list.level, number),
    }),
    ...(list.kind === 'checkbox' && {
      [BOX_CHECKED_ATTRIBUTE]: String(list.isChecked),
    }),
  };
}
export function listOfElement(element: Element): ListLine {
  let kind = element.getAttribute(LIST_ATTRIBUTE);
  let level = Number(element.getAttribute(LIST_LEVEL_ATTRIBUTE));
  if (!isListLevel(level))
    return {
      kind: 'none',
    };
  if (kind === 'bullet' || kind === 'numbered')
    return {
      kind,
      level,
    };
  return kind === 'checkbox'
    ? {
        kind,
        level,
        isChecked: element.getAttribute(BOX_CHECKED_ATTRIBUTE) === 'true',
      }
    : {
        kind: 'none',
      };
}
export function isPressOnListCheckbox(element: HTMLElement, { clientX, clientY }: Pick<MouseEvent, 'clientX' | 'clientY'>): boolean {
  let { left, right, top, width } = element.getBoundingClientRect();
  let { direction, paddingInlineStart, lineHeight } = getComputedStyle(element);
  let scale = element.offsetWidth === 0 ? 1 : width / element.offsetWidth;
  let markerWidth = scale * Number.parseFloat(paddingInlineStart);
  return (
    !(clientY > top + scale * Number.parseFloat(lineHeight)) && (direction === 'rtl' ? clientX > right - markerWidth : clientX < left + markerWidth)
  );
}
export function listFromValue(savedList: unknown): ListLine | null {
  if (typeof savedList !== 'object' || savedList === null || !('kind' in savedList)) return null;
  if (savedList.kind === 'none')
    return {
      kind: 'none',
    };
  let level = 'level' in savedList ? savedList.level : undefined;
  if (typeof level !== 'number' || !isListLevel(level)) return null;
  if (savedList.kind === 'bullet' || savedList.kind === 'numbered')
    return {
      kind: savedList.kind,
      level,
    };
  let isChecked = 'isChecked' in savedList ? savedList.isChecked : undefined;
  return savedList.kind === 'checkbox' && typeof isChecked === 'boolean'
    ? {
        kind: 'checkbox',
        level,
        isChecked,
      }
    : null;
}
/** The data attributes that draw a line as a line of a list: its kind, level, number and whether its box is checked. */
export type ListAttributes = Partial<
  Record<typeof LIST_ATTRIBUTE | typeof LIST_LEVEL_ATTRIBUTE | typeof LIST_NUMBER_ATTRIBUTE | typeof BOX_CHECKED_ATTRIBUTE, string>
>;
export const LIST_ATTRIBUTE = 'data-list';
export const LIST_LEVEL_ATTRIBUTE = 'data-list-level';
export const LIST_NUMBER_ATTRIBUTE = 'data-list-number';
export const BOX_CHECKED_ATTRIBUTE = 'data-is-box-checked';
export const ROMAN_NUMERALS: readonly (readonly [number, string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];
export const listNumberText = (level: number, number: number): string =>
  [String, alphabeticNumeralOf, romanNumeralOf][level % 3]?.(number) ?? String(number);
export const listNumberAttributes = (level: number, number: number): ListAttributes => ({
  [LIST_NUMBER_ATTRIBUTE]: listNumberText(level, number),
});
export const CHECKBOX_LIST_SELECTOR = `[${LIST_ATTRIBUTE}="checkbox"]`;
