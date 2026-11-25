import type { Color, DropdownContents, DropdownOption } from '@open-artifact/sheets-core';
import { stripTextPrefixQuote } from '../model/cell-text.ts';
import { isFormulaCell } from '../model/workbook.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
/** A row of a dropdown's list that picks one of its options. */
export interface OptionMenuItem {
  kind: 'option';
  optionId: string;
  label: string;
  color: Color;
}
/** A row of a dropdown's list that adds what was typed as a new option. */
export interface AddMenuItem {
  kind: 'add';
  label: string;
}
/** A row of a dropdown's list: an option, adding one, editing the options, or starting from a ready set. */
export type DropdownMenuItem = OptionMenuItem | AddMenuItem | { kind: 'addOption' } | { kind: 'editOptions' } | { kind: 'startFromSet' };
export function isOptionText({ options }: Pick<DropdownContents, 'options'>, text: string): boolean {
  let candidates = [text, stripTextPrefixQuote(text)].flatMap((candidate) => [candidate, candidate.trim()]);
  return options.some(({ label }) => candidates.some((candidate) => isSameOptionLabel(label, candidate)));
}
export function dropdownMenuItems(
  options: readonly DropdownOption[],
  typed: string | null,
  cellText: string,
  canStartFromSet: boolean = false,
): DropdownMenuItem[] {
  let filter = cleanTypedLabel(typed ?? '');
  let matchingItems = options.flatMap(
    (option): OptionMenuItem[] =>
      foldLabelCase(option.label).includes(foldLabelCase(filter))
        ? [
            {
              kind: 'option',
              optionId: option.optionId,
              label: option.label,
              color: option.color,
            },
          ]
        : [],
  );
  let labelToAdd = typed === null ? cleanTypedLabel(cellText) : filter;
  let canAdd =
    isValidOptionLabel(labelToAdd) &&
    options.length < MAX_DROPDOWN_OPTIONS &&
    !options.some(({ label }) => isSameOptionLabel(label, labelToAdd));
  return [
    ...matchingItems,
    ...(canAdd
      ? [
          {
            kind: 'add',
            label: labelToAdd,
          } satisfies AddMenuItem,
        ]
      : []),
    ...(typed === null && !canAdd && options.length < MAX_DROPDOWN_OPTIONS
      ? [
          {
            kind: 'addOption',
          } satisfies DropdownMenuItem,
        ]
      : []),
    {
      kind: 'editOptions',
    },
    ...(canStartFromSet && typed === null
      ? [
          {
            kind: 'startFromSet',
          } satisfies DropdownMenuItem,
        ]
      : []),
  ];
}
export function itemToHighlightForTyped(items: readonly DropdownMenuItem[], typed: string): DropdownMenuItem | null {
  let cleaned = cleanTypedLabel(typed);
  let [firstItem] = items;
  if (cleaned === '' || firstItem === undefined || firstItem.kind === 'editOptions') return null;
  return items.find((item) => item.kind === 'option' && isSameOptionLabel(item.label, cleaned)) ?? firstItem;
}
export const MAX_DROPDOWN_OPTIONS = 100;
export const MAX_OPTION_LABEL_LENGTH = 100;
export const OPTION_LABEL_SHOWN_LENGTH = 40;
export const dropdownAtCell = (reads: WorkbookReads, cellId: CellId): DropdownContents | null =>
  isFormulaCell(reads, cellId) ? null : reads.dropdownOf(cellId);
export const optionMenuKey = (optionId: string): string => `option ${optionId}`;
export const menuItemKey = (item: DropdownMenuItem): string => (item.kind === 'option' ? optionMenuKey(item.optionId) : item.kind);
export const optionIdOfMenuKey = (key: string | null): string | null => (key?.startsWith('option ') === true ? key.slice(7) : null);
export const foldLabelCase = (label: string): string =>
  Array.from(label, (char) => char.toLowerCase()).join('');
export const isValidOptionLabel = (label: string): boolean =>
  label !== '' && Array.from(label).length <= MAX_OPTION_LABEL_LENGTH && !/\p{Cc}/u.test(label);
export const isSameOptionLabel = (label: string, otherLabel: string): boolean => foldLabelCase(label) === foldLabelCase(otherLabel);
export const cleanTypedLabel = (text: string): string => stripTextPrefixQuote(text).trim();
