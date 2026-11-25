import { AGENT_NAME } from '../agent/agent-name.ts';
import type { LocalizedDropdownPreset } from './chip-labels.ts';
import type { CellFormatChoiceName } from './format-labels.ts';
import { translateMessage, MESSAGE_LOCALE } from './messages.ts';
import { localizedDropdownPresets, localizeDropdownPreset } from './chip-labels.ts';
import { dropdownPaneMessages, numberFormatChoiceLabel } from './format-labels.ts';
import { STATUS_OPTION_SET } from '../chips/dropdown-presets.ts';
import { sheetMessages } from './sheet-messages.ts';
import { isoDayOfDate } from '../chips/calendar.ts';
import { truncateGraphemes, PERSON_NAME_IN_NOTICE_MAX_CHARACTERS } from './grid-action-labels.ts';
/** An offer of the @ menu to make cells a dropdown of a preset set of options. */
export interface DropdownOfSetOffer {
  kind: 'dropdownOfSet';
  set: LocalizedDropdownPreset;
  label: string;
  /** Words besides the label that find the offer when searched for. */
  alsoFoundBy: string;
}
/** An offer of the @ menu, besides the people it lists. */
export type AtMenuOffer =
  | AskAgentAtMenuOffer
  | { kind: 'calendar'; label: string }
  | { kind: 'day'; day: string; label: string }
  | { kind: 'newDropdown'; set: LocalizedDropdownPreset; label: string }
  | DropdownOfSetOffer
  | { kind: 'several'; offers: DropdownOfSetOffer[]; label: string; spokenLabel: string }
  | { kind: 'checkbox'; label: string };
/** The offer of the @ menu to ask the agent. */
export interface AskAgentAtMenuOffer {
  kind: 'askAgent';
  label: string;
}
export function atMenuSectionTitle(section: string): string | null | undefined {
  switch (section) {
    case 'agent':
      return null;
    case 'people':
      return translateMessage({
        defaultMessage: 'People',
        id: '/jCWnHyUPU',
      });
    case 'dates':
      return translateMessage({
        defaultMessage: 'Dates',
        id: 'UJySni+xnd',
      });
    case 'dropdowns':
      return translateMessage({
        defaultMessage: 'Dropdowns',
        id: '/dIwCVJ82W',
      });
    case 'controls':
      return translateMessage({
        defaultMessage: 'Controls',
        id: 'kN2SksN/UM',
      });
  }
}
export function atMenuOffers(today: Date, isAskAgentOffered: boolean = false): AtMenuOffer[] {
  let presetOffers = localizedDropdownPresets().map(
    ({ label, set }): DropdownOfSetOffer => ({
      kind: 'dropdownOfSet',
      set,
      label,
      alsoFoundBy: dropdownPaneMessages.presets(),
    }),
  );
  return [
    ...(isAskAgentOffered ? [askAgentAtMenuOffer()] : []),
    {
      kind: 'calendar',
      label: translateMessage({
        defaultMessage: 'Date',
        id: 'LkRUflzvmY',
      }),
    },
    {
      kind: 'day',
      day: dayOffsetFrom(today, 0),
      label: translateMessage({
        defaultMessage: 'Today’s date',
        id: 'eYlK1+Lopf',
      }),
    },
    {
      kind: 'day',
      day: dayOffsetFrom(today, 1),
      label: translateMessage({
        defaultMessage: 'Tomorrow’s date',
        id: 'gfuloSQ26K',
      }),
    },
    {
      kind: 'day',
      day: dayOffsetFrom(today, -1),
      label: translateMessage({
        defaultMessage: 'Yesterday’s date',
        id: 'KW4hqJrARz',
      }),
    },
    {
      kind: 'newDropdown',
      set: localizeDropdownPreset(STATUS_OPTION_SET),
      label: translateMessage({
        defaultMessage: 'Dropdown',
        id: 'OK4kYxjHuD',
      }),
    },
    ...presetOffers.slice(0, PRESET_OFFERS_SHOWN),
    {
      kind: 'several',
      offers: presetOffers.slice(PRESET_OFFERS_SHOWN),
      label: translateMessage({
        defaultMessage: 'See more',
        id: '20ZZODSS/l',
      }),
      spokenLabel: translateMessage({
        defaultMessage: 'See more dropdowns',
        id: 'Ew10yMPoHq',
      }),
    },
    {
      kind: 'checkbox',
      label: sheetMessages.checkboxCells(),
    },
  ];
}
export function peopleOnSheetText(names: readonly string[]): string {
  let namedPeople = names.slice(0, MAX_PEOPLE_NAMED_ON_SHEET);
  let othersCount = names.length - namedPeople.length;
  if (othersCount === 0)
    return translateMessage(
      {
        defaultMessage: '{count, plural, one {{people} is on this sheet} other {{people} are on this sheet}}',
        id: 'cR64atl6TQ',
      },
      {
        count: namedPeople.length,
        people: new Intl.ListFormat(MESSAGE_LOCALE).format(namedPeople),
      },
    );
  return translateMessage(
    {
      defaultMessage: '{count, plural, one {{people}, and # other are on this sheet} other {{people}, and # others are on this sheet}}',
      id: 'EzYLgEF4wB',
    },
    {
      count: othersCount,
      people: new Intl.ListFormat(MESSAGE_LOCALE, {
        type: 'unit',
      }).format(namedPeople),
    },
  );
}
export const dayOffsetFrom = (date: Date, days: number): string =>
  isoDayOfDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
export const PRESET_OFFERS_SHOWN = 3;
export const askAgentAtMenuOffer = (): AskAgentAtMenuOffer => ({
  kind: 'askAgent',
  label: translateMessage({
    defaultMessage: 'Ask Agent',
    id: 'pwtGzlHJMi',
  }),
});
export const opensMoreRowsLabel = (label: string): string =>
  translateMessage(
    {
      defaultMessage: '{label}, opens more rows',
      id: 'oXICBakKDO',
    },
    {
      label,
    },
  );
export const editCardHeadingLabel = (option: string): string =>
  translateMessage(
    {
      defaultMessage: 'Edit {option}',
      id: 'WVUwMFglWP',
    },
    {
      option,
    },
  );
export const cardAndRowLabel = (card: string, row: string): string =>
  translateMessage(
    {
      defaultMessage: '{card}. {row}',
      id: 'fSKAM1cnMI',
    },
    {
      card,
      row,
    },
  );
export const deleteCardHeadingLabel = (option: string): string =>
  translateMessage(
    {
      defaultMessage: 'Delete {option}',
      id: '7y6U7TetAq',
    },
    {
      option,
    },
  );
export const optionPlaceInListLabel = (option: string, place: number, optionCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{option}, {place, number} of {optionCount, number}',
      id: '4kKFlX4npa',
    },
    {
      option,
      place,
      optionCount,
    },
  );
export const optionRightArrowToEditLabel = (option: string, place: number, optionCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{option}, {place, number} of {optionCount, number}. Right arrow to edit',
      id: 'QwfwnEkvai',
    },
    {
      option,
      place,
      optionCount,
    },
  );
export const currentColorLabel = (label: string): string =>
  translateMessage(
    {
      defaultMessage: '{label}, current color',
      id: 'WhCMCmtTnC',
    },
    {
      label,
    },
  );
export const keepAsTextLabel = (text: string): string =>
  translateMessage(
    {
      defaultMessage: 'Keep “{text}” as text',
      id: 'jnI/lD2ukb',
    },
    {
      text: truncateGraphemes(text, PERSON_NAME_IN_NOTICE_MAX_CHARACTERS),
    },
  );
export const peopleForCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'People for {cell}',
      id: 'zPCqem0JFu',
    },
    {
      cell,
    },
  );
export const personAlreadyInCellText = (name: string): string =>
  translateMessage(
    {
      defaultMessage: '{name} is already in this cell.',
      id: 'II4UxahKqO',
    },
    {
      name,
    },
  );
export const personChipRemoveHint = (name: string): string =>
  translateMessage(
    {
      defaultMessage: '{name}. Press Backspace or Delete to remove.',
      id: 'DjP1zpZgSM',
    },
    {
      name,
    },
  );
export const cellsAddedToMessageText = (cells: string, isPauseToBeTold: boolean): string =>
  isPauseToBeTold
    ? translateMessage(
        {
          defaultMessage:
            '{cells} added to your message to Agent. Typing in the Sheet is paused. The message box is outside the Sheet. Press Escape to go back to the cells.',
          id: 'sM+EzWDy/k',
        },
        {
          cells,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{cells} added to your message to Agent.',
          id: '/uD0bjYgMc',
        },
        {
          cells,
        },
      );
export const removeItemLabel = (item: string): string =>
  translateMessage(
    {
      defaultMessage: 'Remove {item}',
      id: '+oQ+9icbbr',
    },
    {
      item,
    },
  );
export const insertInCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'Insert in {cell}',
      id: 'KPbSQMBZ0/',
    },
    {
      cell,
    },
  );
export const foldedFlagsCountText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {+#} other {+#}}',
      id: 'znKBNLz3SP',
    },
    {
      count,
    },
  );
export const sheetTabCommentsLabel = (name: string, count: number): string | undefined =>
  count === 0
    ? undefined
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {{name}, # open comment} other {{name}, # open comments}}',
          id: 'qs1Fjy3o4Q',
        },
        {
          name,
          count,
        },
      );
export const MAX_PEOPLE_NAMED_ON_SHEET = 7;
export const agentFlagName = (): string => AGENT_NAME;
export const timesForCellLabel = (cell: string): string =>
  translateMessage(
    {
      defaultMessage: 'Times for {cell}',
      id: '0X6RnZlcBJ',
    },
    {
      cell,
    },
  );
export const suggestionHeardAs = (words: string, isKeyDrawn: boolean): string =>
  isKeyDrawn
    ? translateMessage(
        {
          defaultMessage: 'Suggestion: “{words}”. Press Tab to enter it.',
          id: 'PrniwBoBqs',
        },
        {
          words,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Suggestion: “{words}”, with a button to use it.',
          id: 'bSqv9WVmSQ',
        },
        {
          words,
        },
      );
export const useSuggestionLabel = (words: string): string =>
  translateMessage(
    {
      defaultMessage: 'Use “{words}”',
      id: 'EF/PCUg7m9',
    },
    {
      words,
    },
  );
export const suggestionGoneText = (): string =>
  translateMessage({
    defaultMessage: 'The suggestion is gone.',
    id: 'WZWzllJlbg',
  });
export const tabKeyLabel = (): string =>
  translateMessage({
    defaultMessage: 'Tab',
    id: '3e4DfmbESG',
  });
export const numberFormatButtonLabel = (format: CellFormatChoiceName | 'person'): string =>
  translateMessage(
    {
      defaultMessage: '{format}, Cell type',
      id: 'f5LKZHNQyt',
    },
    {
      format: format === 'person' ? sheetMessages.personCells() : numberFormatChoiceLabel(format),
    },
  );
export const fontSizeText = (size: number | null): string => (size === null ? sheetMessages.signOfMixedFontSizes() : String(size));
export const numberFormatExampleLabel = (format: CellFormatChoiceName, example: string): string =>
  translateMessage(
    {
      defaultMessage: '{format}, {example}',
      id: 'WeysxCROSe',
    },
    {
      format: numberFormatChoiceLabel(format),
      example,
    },
  );
export const fontSizeButtonLabel = (size: number | null): string =>
  translateMessage(
    {
      defaultMessage: '{isMixed, select, true {Font size, Mixed} other {Font size, {size}}}',
      id: 'BGctnjZ5Q9',
    },
    {
      isMixed: String(size === null),
      size: size ?? 0,
    },
  );
