import { MESSAGE_LOCALE, translateMessage } from '../i18n/messages.ts';
import type { ComboboxOption } from '../kit/combobox.tsx';
export let languageNamesFormatter: Intl.DisplayNames | null;
export function languageNameOfLocale(locale: string): string {
  languageNamesFormatter ??= new Intl.DisplayNames(MESSAGE_LOCALE, {
    type: 'language',
    languageDisplay: 'standard',
  });
  return languageNamesFormatter.of(locale) ?? locale;
}
export const sortByLabel = <Choice extends { label: string }>(choices: Iterable<Choice>): Choice[] =>
  [...choices].toSorted((choice, other) => (choice.label < other.label ? -1 : choice.label > other.label ? 1 : 0));
export const foldTextForSearch = (text: string): string =>
  text
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
export const labelMatchesSearch = ({ label }: { label: string }, search: string): boolean =>
  ` ${foldTextForSearch(label)}`.includes(` ${foldTextForSearch(search)}`);
export const localeMessages = {
  locale: () =>
    translateMessage({
      defaultMessage: 'Locale',
      id: '4DDuQyzqZV',
    }),
  whatGoesByIt: () =>
    translateMessage({
      defaultMessage:
        'Sets how numbers (1,234.5 or 1.234,5), dates (12/31/2026 or 31/12/2026), new currency amounts, and month and day names are written for everyone who opens this Sheet. With a decimal comma, formulas separate arguments with semicolons.',
      id: 'zR1o5jt0ws',
    }),
};
languageNamesFormatter = null;
export const localeSetWords = (locale: string): string =>
  translateMessage(
    {
      defaultMessage: 'Locale set to {locale}',
      id: 'sjyIYA/suy',
    },
    {
      locale: languageNameOfLocale(locale),
    },
  );
export const localeChoices = (locales: readonly string[]): ComboboxOption[] =>
  sortByLabel(
    locales.map(
      (locale) => ({
        value: locale,
        label: languageNameOfLocale(locale),
      }),
    ),
  );
