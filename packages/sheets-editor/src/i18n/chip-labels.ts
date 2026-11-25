import type { Color } from '@open-artifact/sheets-core';
import type { DropdownCellsRefused, DropdownOptionRemovedDone, DropdownOptionsAddedDone } from '../state/initial-state.ts';
import { translateMessage } from './messages.ts';
import { dropdownPaneMessages, cellColorName } from './format-labels.ts';
import { DROPDOWN_OPTION_SETS, STATUS_OPTION_SET } from '../chips/dropdown-presets.ts';
/** Options added to a dropdown: how many, how many skipped, whether the dropdown is now full, and the cells when not all of its cells. */
export type DropdownOptionsAdded = Omit<DropdownOptionsAddedDone, 'what'>;
/** An option removed from a dropdown, and the cells when not all of its cells. */
export type DropdownOptionRemoved = Omit<DropdownOptionRemovedDone, 'what'>;
/** The key of a preset set of dropdown options. */
export type DropdownPresetKey = 'status' | 'priority' | 'yesNo' | 'approval' | 'health' | 'size';
/** The key of an option of a preset set of dropdown options. */
export type DropdownPresetOptionKey =
  | 'notStarted'
  | 'inProgress'
  | 'blocked'
  | 'done'
  | 'low'
  | 'medium'
  | 'high'
  | 'yes'
  | 'no'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'onTrack'
  | 'atRisk'
  | 'offTrack'
  | 'small'
  | 'mediumSize'
  | 'large'
  | 'extraLarge';
/** A preset set of dropdown options, by key, with each option's color. */
export interface DropdownPreset {
  key: DropdownPresetKey;
  options: readonly { key: DropdownPresetOptionKey; color: Color }[];
}
/** A preset set of dropdown options with the options in words. */
export interface LocalizedDropdownPreset {
  key: DropdownPresetKey;
  options: { label: string; color: Color }[];
}
/** A preset set of dropdown options and its name. */
export interface NamedDropdownPreset {
  label: string;
  set: LocalizedDropdownPreset;
}
/** The format that makes cells a dropdown, starting from the status preset. */
export interface NewDropdownFormat {
  dropdown: true;
  firstSet: LocalizedDropdownPreset;
  setsByName: NamedDropdownPreset[];
}
export function dropdownPresetName(preset: DropdownPresetKey): string {
  switch (preset) {
    case 'status':
      return translateMessage({
        defaultMessage: 'Status',
        id: 'SgkL8mZWEy',
      });
    case 'priority':
      return translateMessage({
        defaultMessage: 'Priority',
        id: 'JLsKyLlnLt',
      });
    case 'yesNo':
      return translateMessage({
        defaultMessage: 'Yes / No',
        id: '9VJcM5aKsz',
      });
    case 'approval':
      return translateMessage({
        defaultMessage: 'Approval',
        id: 'OINjBG1LQD',
      });
    case 'health':
      return translateMessage({
        defaultMessage: 'Health',
        id: 'uQgYkO+hAY',
      });
    case 'size':
      return translateMessage({
        defaultMessage: 'Size',
        id: 'UBahCp+LOr',
      });
  }
}
export function dropdownPresetOptionLabel(optionKey: DropdownPresetOptionKey): string {
  switch (optionKey) {
    case 'notStarted':
      return translateMessage({
        defaultMessage: 'Not started',
        id: 'KV98WTt9HG',
      });
    case 'inProgress':
      return translateMessage({
        defaultMessage: 'In progress',
        id: 'RsCTKkON7P',
      });
    case 'blocked':
      return translateMessage({
        defaultMessage: 'Blocked',
        id: 'VfkBEJfMJz',
      });
    case 'done':
      return translateMessage({
        defaultMessage: 'Done',
        id: 'E8+1eZ+ib0',
      });
    case 'low':
      return translateMessage({
        defaultMessage: 'Low',
        id: 'NkYDsMlhGz',
      });
    case 'medium':
      return translateMessage({
        defaultMessage: 'Medium',
        id: 'aMIwtNQZ4U',
      });
    case 'high':
      return translateMessage({
        defaultMessage: 'High',
        id: 'c4a5NqEk7R',
      });
    case 'yes':
      return translateMessage({
        defaultMessage: 'Yes',
        id: 'cO9FmwXjPg',
      });
    case 'no':
      return translateMessage({
        defaultMessage: 'No',
        id: 'S4ap9EIwn7',
      });
    case 'pending':
      return translateMessage({
        defaultMessage: 'Pending',
        id: 'CN5k/QcesU',
      });
    case 'approved':
      return translateMessage({
        defaultMessage: 'Approved',
        id: 'YcbD+FfOku',
      });
    case 'rejected':
      return translateMessage({
        defaultMessage: 'Rejected',
        id: 'BSEpvYkQvj',
      });
    case 'onTrack':
      return translateMessage({
        defaultMessage: 'On track',
        id: 'phfUMOJdWT',
      });
    case 'atRisk':
      return translateMessage({
        defaultMessage: 'At risk',
        id: '0iUayl6kJM',
      });
    case 'offTrack':
      return translateMessage({
        defaultMessage: 'Off track',
        id: '63UBTStjtt',
      });
    case 'small':
      return translateMessage({
        defaultMessage: 'S',
        id: '1cZ8tqv/S9',
      });
    case 'mediumSize':
      return translateMessage({
        defaultMessage: 'M',
        id: 'd+mdfwe1bv',
      });
    case 'large':
      return translateMessage({
        defaultMessage: 'L',
        id: 'yoA4eGR83G',
      });
    case 'extraLarge':
      return translateMessage({
        defaultMessage: 'XL',
        id: 'z2yNZQ1Xxc',
      });
  }
}
export function dropdownOptionsAddedForCellsText({ count, skipped, isFull }: DropdownOptionsAdded, cells: string): string {
  if (skipped === 0)
    return translateMessage(
      {
        defaultMessage: '{count, plural, one {# option added for {cells}} other {# options added for {cells}}}',
        id: 'Bejxh9q0n2',
      },
      {
        count,
        cells,
      },
    );
  return isFull
    ? translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# option added for {cells}, {skipped, number} skipped. A dropdown can have up to 100 options.} other {# options added for {cells}, {skipped, number} skipped. A dropdown can have up to 100 options.}}',
          id: 'HcIfGRClaP',
        },
        {
          count,
          skipped,
          cells,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# option added for {cells}, {skipped, number} skipped} other {# options added for {cells}, {skipped, number} skipped}}',
          id: 'GC/TNaD6ta',
        },
        {
          count,
          skipped,
          cells,
        },
      );
}
export function dropdownOptionRemovedText({ label, isSaved, onlyIn }: DropdownOptionRemoved): string {
  if (onlyIn === null)
    return isSaved
      ? translateMessage(
          {
            defaultMessage: '{label} removed',
            id: 'TbV92pVIDf',
          },
          {
            label,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Removing {label}…',
            id: 'D8EnMKaN46',
          },
          {
            label,
          },
        );
  return isSaved
    ? translateMessage(
        {
          defaultMessage: '{label} removed for {cells}',
          id: '20Y1875V32',
        },
        {
          label,
          cells: onlyIn,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Removing {label} for {cells}…',
          id: '18SzHGtWS5',
        },
        {
          label,
          cells: onlyIn,
        },
      );
}
export function dropdownOptionsAddedText(added: DropdownOptionsAdded): string {
  let { count, skipped, isFull, onlyIn } = added;
  if (onlyIn !== null && count > 0) return dropdownOptionsAddedForCellsText(added, onlyIn);
  if (skipped === 0)
    return translateMessage(
      {
        defaultMessage: '{count, plural, one {# option added} other {# options added}}',
        id: 'fYWNJMyaET',
      },
      {
        count,
      },
    );
  return isFull
    ? translateMessage(
        {
          defaultMessage:
            '{count, plural, =0 {No options added, {skipped, number} skipped. A dropdown can have up to 100 options.} one {# option added, {skipped, number} skipped. A dropdown can have up to 100 options.} other {# options added, {skipped, number} skipped. A dropdown can have up to 100 options.}}',
          id: 'nibirqsMdi',
        },
        {
          count,
          skipped,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{count, plural, =0 {No options added, {skipped, number} skipped} one {# option added, {skipped, number} skipped} other {# options added, {skipped, number} skipped}}',
          id: 'Ny0xdVQMrn',
        },
        {
          count,
          skipped,
        },
      );
}
export function dropdownCellsRefusalText(refusal: DropdownCellsRefused): string {
  switch (refusal.why) {
    case 'ofAnotherDropdown':
      return translateMessage({
        defaultMessage: 'Some of those cells have another dropdown. Choose cells without one.',
        id: '4SdStSH7s/',
      });
    case 'holdFormula':
      return translateMessage({
        defaultMessage: 'Some of those cells have a formula. Choose cells without one.',
        id: 'MWpiJWaTAz',
      });
    case 'holdNoOption':
      return translateMessage({
        defaultMessage: 'Some of those cells have content that isn’t an option. Choose other cells, or add it as an option.',
        id: '2Mdw/VhtyD',
      });
    case 'headingIsNoOption':
      return translateMessage({
        defaultMessage: 'This heading can’t be an option. You can edit it or remove an option.',
        id: 'yCbTcGS1N3',
      });
    case 'notFound':
      return translateMessage(
        {
          defaultMessage: '“{typed}” doesn’t name any cells in this sheet. Try something like C2:C20.',
          id: 'eUp4N+4rRP',
        },
        {
          typed: refusal.typed,
        },
      );
  }
}
export function personRowLabel(name: string, who: string | null, isHeldByCell: boolean): string {
  if (who === 'you')
    return isHeldByCell
      ? translateMessage(
          {
            defaultMessage: '{name}, you, already in this cell',
            id: 'tSRj477kGB',
          },
          {
            name,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{name}, you',
            id: '2V/02EhhX+',
          },
          {
            name,
          },
        );
  if (who === 'guest')
    return isHeldByCell
      ? translateMessage(
          {
            defaultMessage: '{name}, guest, already in this cell',
            id: '700YyKou/7',
          },
          {
            name,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{name}, guest',
            id: 'Tj7buc6HSP',
          },
          {
            name,
          },
        );
  return isHeldByCell
    ? translateMessage(
        {
          defaultMessage: '{name}, already in this cell',
          id: 'b2FdOsDZh2',
        },
        {
          name,
        },
      )
    : name;
}
export const localizeDropdownPreset = ({ key, options }: DropdownPreset): LocalizedDropdownPreset => ({
  key,
  options: options.map(
    (option) => ({
      label: dropdownPresetOptionLabel(option.key),
      color: option.color,
    }),
  ),
});
export const dropdownPresetChosenText = (preset: DropdownPresetKey | 'custom', optionCount: number): string =>
  preset === 'custom'
    ? translateMessage({
        defaultMessage: 'Custom: type your own options',
        id: 'mKDhqTncT7',
      })
    : translateMessage(
        {
          defaultMessage: '{optionCount, plural, one {{set} preset: # option} other {{set} preset: # options}}',
          id: 'wvCrx7vsJu',
        },
        {
          set: dropdownPresetName(preset),
          optionCount,
        },
      );
export const dropdownPresetButtonLabel = (chosen: DropdownPresetKey | 'custom'): string =>
  translateMessage(
    {
      defaultMessage: 'Preset: {chosen}',
      id: 'tXt7SnGmJt',
    },
    {
      chosen: chosen === 'custom' ? dropdownPaneMessages.customOptions() : dropdownPresetName(chosen),
    },
  );
export const localizedDropdownPresets = (): NamedDropdownPreset[] =>
  DROPDOWN_OPTION_SETS.map(
    (preset) => ({
      label: dropdownPresetName(preset.key),
      set: localizeDropdownPreset(preset),
    }),
  );
export const newDropdownFormat = (): NewDropdownFormat => ({
  dropdown: true,
  firstSet: localizeDropdownPreset(STATUS_OPTION_SET),
  setsByName: localizedDropdownPresets(),
});
export const toolUnavailableText = (tool: string): string =>
  translateMessage(
    {
      defaultMessage: '{tool} isn’t available for the selected cells.',
      id: 'e/dmZcDOeR',
    },
    {
      tool,
    },
  );
export const newDropdownFormatOpeningList = (): NewDropdownFormat & { replacesFormulas: true; thenOpens: 'list' } => ({
  ...newDropdownFormat(),
  replacesFormulas: true,
  thenOpens: 'list',
});
export const dropdownOptionsForCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'Options for {cell}',
      id: 'XX8Kx3pmzc',
    },
    {
      cell,
    },
  );
export const optionListForCellLabel = (cell: string, optionCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{optionCount, plural, one {List of # option for {cell}} other {List of # options for {cell}}}',
      id: 'h5Z2oh9cY7',
    },
    {
      cell,
      optionCount,
    },
  );
export const addOptionText = (text: string): string =>
  translateMessage(
    {
      defaultMessage: 'Add “{text}”',
      id: 'oY52ahYifg',
    },
    {
      text,
    },
  );
export const optionColorName = (color: Color): string =>
  color.kind !== 'standard'
    ? cellColorName('fillColor', color)
    : translateMessage(
        {
          defaultMessage:
            '{hue, select, gray {Gray} red {Red} orange {Orange} yellow {Yellow} green {Green} teal {Teal} blue {Blue} purple {Purple} magenta {Magenta} other {Other}}',
          id: '57+0RleDvz',
        },
        {
          hue: color.hue,
        },
      );
export const dropdownCellsButtonLabel = (chosen: string): string =>
  translateMessage(
    {
      defaultMessage: 'Cells: {chosen}',
      id: 'zHGk+7S5VH',
    },
    {
      chosen,
    },
  );
export const onlyCellsLabel = (cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Only {cells}',
      id: '7FeNQfMC4C',
    },
    {
      cells,
    },
  );
export const optionAlreadyExistsText = (optionLabel: string): string =>
  translateMessage(
    {
      defaultMessage: '“{option}” is already an option.',
      id: 'F1OPOBT5CH',
    },
    {
      option: optionLabel,
    },
  );
export const optionNumberLabel = (number: number): string =>
  translateMessage(
    {
      defaultMessage: 'Option {number, number}',
      id: '8/pRdQ3zFj',
    },
    {
      number,
    },
  );
export const optionColorButtonLabel = (number: number): string =>
  translateMessage(
    {
      defaultMessage: 'Option {number, number} color',
      id: 'c8ATfwcTzC',
    },
    {
      number,
    },
  );
export const optionColorButtonHeardAs = (number: number, color: Color): string =>
  translateMessage(
    {
      defaultMessage: 'Option {number, number} color, {color}',
      id: 'ya0bzzyz5p',
    },
    {
      number,
      color: cellColorName('fillColor', color),
    },
  );
export const reorderOptionLabel = (number: number, label: string): string =>
  label.trim() === ''
    ? translateMessage(
        {
          defaultMessage: 'Reorder option {number, number}',
          id: 'V/W03J+8oN',
        },
        {
          number,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Reorder {label}',
          id: 'Cxw6Low+ad',
        },
        {
          label: label.trim(),
        },
      );
export const removeOptionLabel = (number: number, label: string): string =>
  label.trim() === ''
    ? translateMessage(
        {
          defaultMessage: 'Remove option {number, number}',
          id: 'Ieu729Co2l',
        },
        {
          number,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Remove {label}',
          id: 't8XK4f/n97',
        },
        {
          label: label.trim(),
        },
      );
export const peoplePickerMessages = {
  searching: () =>
    translateMessage({
      defaultMessage: 'Searching…',
      id: 'R5W/gP878D',
    }),
  found: (count: number): string =>
    translateMessage(
      {
        defaultMessage: '{count, plural, =0 {No people found} one {# person listed} other {# people listed}}',
        id: 'kE0OOmcExu',
      },
      {
        count,
      },
    ),
  noMatches: () =>
    translateMessage({
      defaultMessage: 'No matches',
      id: '05nEyZDrRm',
    }),
  noMatchingPeople: () =>
    translateMessage({
      defaultMessage: 'No matching people',
      id: 'BWAIVccO+E',
    }),
  keepTyping: () =>
    translateMessage({
      defaultMessage: 'Keep typing to search people',
      id: '3uisiQfQ47',
    }),
  addPeople: () =>
    translateMessage({
      defaultMessage: 'Add people',
      id: 'XK/aWA01DN',
    }),
  addMore: () =>
    translateMessage({
      defaultMessage: 'Add more',
      id: 'AS+Bobws/Y',
    }),
  you: () =>
    translateMessage({
      defaultMessage: 'You',
      id: 'xJE9TB9PQY',
    }),
  guest: () =>
    translateMessage({
      defaultMessage: 'Guest',
      id: 'Zo/z4eGuKq',
    }),
};
export const morePeopleCountText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {+#} other {+#}}',
      id: 'vCW45oQJS9',
    },
    {
      count,
    },
  );
