import type { ValueContents } from '@open-artifact/sheets-core';
import type { ColumnHolds, TableHolds } from '../state/initial-state.ts';
import type { TypedWord } from './tokens.ts';
import { splitIntoWords, plainWordsOf, wordsMatchAt, NO_WORD_TOKEN, isSymbolForNotOrIs, isWordOrItsPlural } from './tokens.ts';
import {
  COMMAND_WORDS,
  FILTER_FILLER_WORDS,
  EQUALS_WORDS,
  SHOW_VERBS,
  NEGATING_WORDS,
  BLANK_WORDS,
  QUESTION_FILLER_WORDS,
  LIST_JOINERS,
  TASK_NOUNS,
  WORDS_AFTER_COLUMN_NAME,
  UNASSIGNED_PHRASES,
  FILLED_WORDS,
  DATE_CONDITION_WORDS,
  NUMBER_CONDITION_WORDS,
  TEXT_TEST_WORDS,
  LARGEST_SMALLEST_WORDS,
  CHECKED_RULE_WORDS,
  UNCHECKED_WORDS,
  WORDS_NOT_TAKEN_AS_VALUES,
} from './vocabulary.ts';
import { valuesOfUserInColumn, isPeopleColumn, measureOfColumn } from './column-holds.ts';
import { columnNameWords } from './numbers.ts';
/** A column, or a part of its name, as words may name it. */
export interface ColumnNamed {
  column: ColumnHolds;
  /** The plain words of the name or of the part. */
  name: string[];
  wordCount: number;
  isPart: boolean;
  isUnsure: boolean;
  /** The name is a single word the words also use to ask for something. */
  isAWord: boolean;
  /** The name is a single filler word, passed over unless asked for. */
  isPassedOver: boolean;
}
/** Words that name values of a column, before it is known how they may be read. */
interface WordsForValues {
  words: string[];
  values: (ValueContents | null)[];
  userId?: string;
  isFirstName?: boolean;
}
/** Words that name values of a column. */
export interface ValueLabel {
  words: string[];
  values: (ValueContents | null)[];
  /** The words name the values only after the column's name. */
  needsHeader: boolean;
  isFirstName: boolean;
  /** The words may be a part of longer words that name something else. */
  mayMeanMore: boolean | 'unlessTypedPlainly';
}
/** Which columns to look for named values in: `only` that one, or every column of few values and `rather` this one. */
export interface ValueLookup {
  only: ColumnHolds | null;
  rather: ColumnHolds | null;
  wholeLabelsOnly?: boolean;
}
/** Values of a column named by the words at a place. */
export interface ValueNamed {
  column: ColumnHolds;
  values: (ValueContents | null)[];
  wordCount: number;
  isFirstName: boolean;
  mayMeanMore: boolean | 'unlessTypedPlainly';
  isExact: boolean;
}
export function nameWordsWithBreaks(name: string): string[] {
  let words = splitIntoWords(name);
  let plainWords = words.map(({ plain }) => plain);
  if (/[-!=:<>≠'’"“”([….]/.test(name))
    breaksAllowedInNameCache.set(
      plainWords,
      new Set<number>(words.flatMap(({ at }) => (isWordBreakAt(words, at, at === 0) ? [at] : []))),
    );
  return plainWords;
}
export function columnNamesOf(columns: ColumnHolds[]): ColumnNamed[] {
  let cached = columnNamesCache.get(columns);
  if (cached !== undefined) return cached;
  let names = columns.flatMap((column): ColumnNamed[] => {
    let nameWords = nameWordsWithBreaks(column.name ?? '');
    let [firstWord, ...otherWords] = nameWords;
    let isAWord = firstWord !== undefined && otherWords.length === 0 && COMMAND_WORDS.has(firstWord);
    let isPassedOver = isAWord && FILTER_FILLER_WORDS.has(firstWord) && !EQUALS_WORDS.has(firstWord) && !SHOW_VERBS.has(firstWord);
    return firstWord === undefined
      ? []
      : [
          {
            column,
            name: nameWords,
            wordCount: nameWords.length,
            isPart: false,
            isUnsure: false,
            isAWord,
            isPassedOver,
          },
        ];
  });
  columnNamesCache.set(columns, names);
  return names;
}
export function isAbbreviationOf(short: string, long: string): boolean {
  if (short.length < 2 || short.length >= long.length || short[0] !== long[0]) return false;
  let matched = 0;
  for (let letter of long) if (letter === short[matched]) matched += 1;
  return matched === short.length;
}
export function columnNamePartsOf(columns: ColumnHolds[]): ColumnNamed[] {
  let cached = columnNamePartsCache.get(columns);
  if (cached !== undefined) return cached;
  let parts = new Map<string, ColumnNamed | null>();
  let valueWords = new Set<string>(
    columns
      .filter(isColumnOfFewValues)
      .flatMap((column) => valueLabelsOf(column).flatMap(({ words }) => words)),
  );
  for (let nameEntry of columnNamesOf(columns)) {
    if (nameEntry.name.length > MOST_NAME_WORDS) continue;
    if (nameEntry.name.some((word) => NEGATING_WORDS.has(word) || NEGATING_PREFIXES.has(word) || BLANK_WORDS.has(word))) continue;
    let bracketWords = new Set<string>(((nameEntry.column.name ?? '').match(/\([^()]*\)/g) ?? []).flatMap(plainWordsOf));
    let tellingWords = nameEntry.name.filter(
      (word) => isTellingNameWord(word) && !bracketWords.has(word) && !ESTIMATE_WORDS.has(word),
    );
    let partTexts = new Set<string>();
    for (let partStart = 0; partStart < nameEntry.name.length; partStart += 1)
      for (let partEnd = partStart + 1; partEnd <= nameEntry.name.length; partEnd += 1) {
        let slice = nameEntry.name.slice(partStart, partEnd);
        if (!isTellingNameWord(slice[0] ?? '') || !isTellingNameWord(slice.at(-1) ?? '')) continue;
        if (tellingWords.every((word) => slice.includes(word))) partTexts.add(slice.join(' '));
      }
    for (let partText of partTexts) {
      let partWords = partText.split(' ');
      let isUnsure =
        (partWords.length === 1 && QUESTION_FILLER_WORDS.has(partText)) || partWords.some((word) => valueWords.has(word));
      let partEntry = {
        ...nameEntry,
        name: partWords,
        wordCount: partWords.length,
        isPart: true,
        isUnsure,
      };
      parts.set(partText, parts.has(partText) ? null : partEntry);
    }
  }
  for (let [partText, partEntry] of parts)
    if (
      partEntry !== null &&
      columnNamesOf(columns).some(
        ({ column, name }) =>
          column !== partEntry.column && partEntry.name.every((word) => isNameAlike(name, word)),
      )
    )
      parts.set(partText, null);
  let [dateName, ...otherDateNames] = columnNamesOf(columns).filter(({ column }) => column.kind === 'date');
  if (dateName !== undefined && otherDateNames.length === 0 && !columns.some(looksLikeDateColumn))
    parts.set('date', {
      ...dateName,
      name: ['date'],
      wordCount: 1,
      isPart: true,
      isUnsure: false,
    });
  let found = [...parts.values()].filter((partEntry) => partEntry !== null);
  columnNamePartsCache.set(columns, found);
  return found;
}
export function columnNamesByStart(columns: ColumnHolds[]): Map<string, ColumnNamed[]> {
  let cached = columnNamesByStartCache.get(columns);
  if (cached !== undefined) return cached;
  let byStart = new Map<string, ColumnNamed[]>();
  for (let columnName of [...columnNamesOf(columns), ...columnNamePartsOf(columns)]) {
    let start = (columnName.name[0] ?? '').slice(0, 2);
    let sameStart = byStart.get(start);
    if (sameStart === undefined) byStart.set(start, [columnName]);
    else sameStart.push(columnName);
  }
  columnNamesByStartCache.set(columns, byStart);
  return byStart;
}
export function columnNamedAt(
  { columns }: Pick<TableHolds, 'columns'>,
  words: readonly TypedWord[],
  at: number,
  allowWords: boolean = false,
  allowUnsure: boolean = false,
): ColumnNamed | null {
  let sameStart = (columnNamesByStart(columns).get((words[at]?.plain ?? '').slice(0, 2)) ?? []).filter(
    ({ isAWord, isPassedOver, isUnsure }) =>
      (!isAWord || (allowWords && isPassedOver)) && (!isUnsure || allowUnsure),
  );
  if (sameStart.length === 0) return null;
  let [wholeNames, partNames] = [
    sameStart.filter(({ isPart }) => !isPart),
    sameStart.filter(({ isPart }) => isPart),
  ];
  let pickLongest = (named: ColumnNamed[]): ColumnNamed | null => {
    let mostWords = Math.max(...named.map(({ wordCount }) => wordCount));
    let [longest, ...othersAsLong] = named.filter(({ wordCount }) => wordCount === mostWords);
    return othersAsLong.length === 0 ? (longest ?? null) : null;
  };
  let matchingWholeNames = wholeNames.filter(({ name }) => nameMatchesAt(words, at, name));
  if (matchingWholeNames.length > 0) return pickLongest(matchingWholeNames);
  let isUnbrokenName = ({ name }: ColumnNamed): boolean => {
    let lastPlain = words[at + name.length - 1]?.plain ?? '';
    return (
      wordsMatchAt(words, at, name.slice(0, -1)) &&
      lastPlain.length >= LEAST_LETTERS_TO_COMPLETE_NAME &&
      !COMMAND_WORDS.has(lastPlain) &&
      name.at(-1)?.startsWith(lastPlain) === true &&
      isUnbrokenAt(words, at, name)
    );
  };
  let candidates = [
    ...wholeNames.filter(isUnbrokenName),
    ...partNames.filter(({ name }) => nameMatchesAt(words, at, name)),
  ];
  if (candidates.length > 0) return pickLongest(candidates);
  return pickLongest(partNames.filter(isUnbrokenName));
}
export function cachedPerObject<Key extends object, Value>(compute: (key: Key) => Value): (key: Key) => Value {
  let cache = new WeakMap<Key, Value>();
  return (key: Key) => {
    let value = cache.get(key) ?? compute(key);
    if (!cache.has(key)) cache.set(key, value);
    return value;
  };
}
export function isSingleWordValueOf(column: ColumnHolds, word: string): boolean {
  let singleWords = singleWordValuesOf(column);
  return singleWords.has(word) || singleWords.has(`${word}s`) || (word.endsWith('s') && singleWords.has(word.slice(0, -1)));
}
export function valueLabelsOf(column: ColumnHolds): ValueLabel[] {
  let cached = valueLabelsCache.get(column);
  if (cached !== undefined) return cached;
  let valueLabels = column.values.flatMap(({ value, userIds: [userId, ...moreUserIds] }) => {
    if (value === null || value.kind === 'error' || value.kind === 'boolean') return [];
    if (moreUserIds.length > 0) return [];
    let values = userId === undefined ? [value] : valuesOfUserInColumn(column, userId);
    return [
      {
        words: nameWordsWithBreaks(String(value.value)),
        values,
        userId,
      },
    ];
  });
  let valueTexts = new Set<string>(valueLabels.map(({ words }) => words.join(' ')));
  let dropdownLabels = (column.optionsOfDropdown ?? []).flatMap((option) => {
    let words = nameWordsWithBreaks(option);
    let optionValue: ValueContents = {
      kind: 'text',
      value: option,
    };
    return valueTexts.has(words.join(' '))
      ? []
      : [
          {
            words,
            values: [optionValue],
          },
        ];
  });
  let wordCounts = new Map<string, number>();
  for (let { words } of [...valueLabels, ...dropdownLabels])
    for (let word of words) wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
  let sharedValues = column.values.flatMap(
    ({ value, userIds }) =>
      value === null || userIds.length < 2
        ? []
        : [
            {
              words: plainWordsOf(String(value.value)),
              userIds,
            },
          ],
  );
  let firstNameLabels = valueLabels.flatMap(
    ({ words: [firstWord = '', ...moreWords], values, userId }) => {
      if (userId === undefined || moreWords.length === 0 || !/^\p{L}{2,}$/u.test(firstWord)) return [];
      let forms = pluralFormsOf(firstWord);
      return !forms.some((form) => COMMAND_WORD_SETS.some((wordSet) => wordSet.has(form))) &&
        forms.reduce((sum, form) => sum + (wordCounts.get(form) ?? 0), 0) === 1 &&
        sharedValues.every(
          ({ words, userIds }) =>
            words.filter((word) => forms.includes(word)).length <= Number(userIds.includes(userId)),
        )
        ? [
            {
              words: [firstWord],
              values,
              isFirstName: true,
            },
          ]
        : [];
    },
  );
  let isPlainText = column.kind === 'text' && !isColumnOfFewValues(column);
  let allLabels: WordsForValues[] = [...valueLabels, ...dropdownLabels, ...firstNameLabels];
  let innerPhrases = new Set<string>();
  let phrasesBeforeSignedEnd = new Set<string>();
  for (let { words, values } of isPeopleColumn(column) || measureOfColumn(column) !== null ? [] : allLabels) {
    let endsInSignedNumber = /\d[-+−]+$/.test(String(values[0]?.value ?? ''));
    if (words.length < 2 || words.length > MOST_NAME_WORDS || NEGATING_WORDS.has(words[0] ?? '') || words.includes(',')) continue;
    for (let from = 0; from < words.length; from += 1)
      for (let to = from + 1; to <= words.length && to - from < words.length; to += 1)
        (endsInSignedNumber && from === 0 && to === words.length - 1 ? phrasesBeforeSignedEnd : innerPhrases).add(words.slice(from, to).join(' '));
  }
  let isLabelText = (text: string): boolean =>
    valueTexts.has(text) || dropdownLabels.some(({ words }) => words.join(' ') === text);
  let isListOfLabels = (words: string[]): boolean =>
    words.some((word) => LIST_JOINERS.has(word)) &&
    words
      .map((word) => (LIST_JOINERS.has(word) ? '|' : word))
      .join(' ')
      .split(' | ')
      .every(isLabelText);
  let labels = (isPlainText ? [] : allLabels).flatMap(({ words, values, isFirstName = false }): ValueLabel[] => {
    let [firstWord, ...otherWords] = words;
    if (firstWord === undefined || values.length === 0 || words.includes(',') || (otherWords.length > 1 && isListOfLabels(words))) return [];
    let needsHeaderIfAlone =
      firstWord.length === 1 || COMMAND_WORDS.has(firstWord) || TASK_NOUNS.has(firstWord) || /^-?[\d.]+$/.test(firstWord);
    let mayMeanMore: boolean | 'unlessTypedPlainly' =
      (otherWords.length > 1 && words.some((word) => LIST_JOINERS.has(word))) ||
      (innerPhrases.size > 0 && innerPhrases.has(words.join(' '))) ||
      (phrasesBeforeSignedEnd.has(words.join(' ')) && 'unlessTypedPlainly');
    return [
      {
        words,
        values,
        needsHeader: otherWords.length === 0 && needsHeaderIfAlone,
        isFirstName,
        mayMeanMore,
      },
    ];
  });
  valueLabelsCache.set(column, labels);
  return labels;
}
export function valuesNamedAt(holds: TableHolds, words: readonly TypedWord[], at: number, lookup: ValueLookup): ValueNamed[] {
  let byWords = valuesNamedCache.get(holds) ?? new WeakMap<readonly TypedWord[], Map<string, ValueNamed[]>>();
  valuesNamedCache.set(holds, byWords);
  let byKey = byWords.get(words) ?? new Map<string, ValueNamed[]>();
  byWords.set(words, byKey);
  let key = [at, lookup.only?.c, lookup.rather?.c, lookup.wholeLabelsOnly === true].join('|');
  let found = byKey.get(key) ?? findValuesNamedAt(holds, words, at, lookup);
  byKey.set(key, found);
  return found;
}
export function findValuesNamedAt(
  holds: TableHolds,
  words: readonly TypedWord[],
  at: number,
  { only, rather, wholeLabelsOnly }: ValueLookup,
): ValueNamed[] {
  let longest: ValueNamed[] = [];
  let columns =
    only === null ? holds.columns.filter((column) => isColumnOfFewValues(column) || column === rather) : [only];
  for (let column of columns)
    for (let { words: labelWords, values, needsHeader, isFirstName, mayMeanMore } of valueLabelsOf(
      column,
    )) {
      if ((needsHeader && column !== only && column !== rather) || !nameMatchesAt(words, at, labelWords)) continue;
      if (isFirstName && (wholeLabelsOnly === true || words[at]?.isInQuotes === true)) continue;
      let longestWordCount = longest[0]?.wordCount ?? 0;
      let found = {
        column,
        values,
        wordCount: labelWords.length,
        isFirstName,
        mayMeanMore,
        isExact: words[at + labelWords.length - 1]?.plain === labelWords.at(-1),
      };
      if (labelWords.length > longestWordCount) longest = [found];
      else if (labelWords.length === longestWordCount) longest = [...longest, found];
    }
  let notFirstNames = longest.filter(({ isFirstName }) => !isFirstName);
  let preferred = notFirstNames.length > 0 ? notFirstNames : longest;
  return preferred.filter(
    (found) => found.isExact || !preferred.some((other) => other.isExact && other.column === found.column),
  );
}
export function valueNamedAt(holds: TableHolds, words: readonly TypedWord[], at: number, lookup: ValueLookup): ValueNamed | null {
  let found = valuesNamedAt(holds, words, at, lookup);
  let [first, ...others] = found;
  if (first === undefined || others.length === 0) return first ?? null;
  let columnNamedAfter = columnNamedBeforeValueAt(holds, words, at + first.wordCount);
  let foundInRather = found.find(({ column }) => column === lookup.rather);
  let isRatherInexact = foundInRather?.isExact === false && found.some(({ isExact }) => isExact);
  return found.find(({ column }) => column === columnNamedAfter) ?? (isRatherInexact ? null : (foundInRather ?? null));
}
export function columnNamedBeforeValueAt(holds: TableHolds, words: readonly TypedWord[], at: number): ColumnHolds | null {
  let named = columnNamedAt(holds, words, at);
  if (named === null || isOnlyTextColumn(holds, named.column)) return null;
  let [firstNameWord, ...otherNameWords] = plainWordsOf(named.column.name ?? '');
  if (otherNameWords.length === 0 && TASK_NOUNS.has(firstNameWord ?? '')) return null;
  let afterName = at + named.wordCount;
  return WORDS_AFTER_COLUMN_NAME.has(words[afterName]?.plain ?? '') ||
    (isPeopleColumn(named.column) && unassignedPhraseLengthAt(words, afterName) > 0) ||
    valueNamedAt(holds, words, afterName, {
      only: named.column,
      rather: null,
    }) !== null
    ? null
    : named.column;
}
export const LEAST_LETTERS_TO_COMPLETE_NAME = 3;
export const isWordBreakAt = (words: readonly TypedWord[], at: number, isFirst: boolean = false): boolean => {
  let word = words[at] ?? NO_WORD_TOKEN;
  let isSetApart = word.isInQuotes !== (words[at - 1]?.isInQuotes ?? false) || /^['’]\D/.test(word.said) || /[([…]|\.\.\./.test(word.gap);
  return isSymbolForNotOrIs(word) || (!isFirst && isSetApart);
};
export const breaksAllowedInNameCache = new WeakMap<string[], Set<number>>();
export const isUnbrokenAt = (words: readonly TypedWord[], at: number, name: string[]): boolean =>
  name.every(
    (nameWord, offset) =>
      !isWordBreakAt(words, at + offset, offset === 0) || breaksAllowedInNameCache.get(name)?.has(offset) === true,
  );
export const nameMatchesAt = (words: readonly TypedWord[], at: number, name: string[]): boolean =>
  wordsMatchAt(words, at, name.slice(0, -1)) &&
  isWordOrItsPlural(words[at + name.length - 1]?.plain ?? '', name.at(-1) ?? '') &&
  isUnbrokenAt(words, at, name);
export const columnNamesCache = new WeakMap<ColumnHolds[], ColumnNamed[]>();
export const ESTIMATE_WORDS = new Set<string>(['est', 'estimated', 'approx']);
export const NEGATING_PREFIXES = new Set<string>(['non', 'un', 'ex', 'never', 'dont']);
export const isNameAlike = (nameWords: string[], word: string): boolean =>
  nameWords.some((nameWord) => nameWord === word || isAbbreviationOf(nameWord, word) || isAbbreviationOf(word, nameWord));
export const MOST_NAME_WORDS = 8;
export const columnNamePartsCache = new WeakMap<ColumnHolds[], ColumnNamed[]>();
export const isTellingNameWord = (word: string): boolean =>
  /^\p{L}{2}/u.test(word) && word !== 'date' && !NON_NAME_WORD_SETS.some((wordSet) => wordSet.has(word));
export const columnNamesByStartCache = new WeakMap<ColumnHolds[], Map<string, ColumnNamed[]>>();
export const hasZeroValues = cachedPerObject(
  (column: ColumnHolds) =>
    measureOfColumn(column) === 'numbers' && column.values.some(({ value }) => value?.value === 0),
);
export const dateLikeTextPattern =
  /^\d{1,4}([-/.])\d{1,2}\1\d{1,4}(?:[ T]\d{1,2}:\d{2}.*)?$|^\d{1,2}\/\d{1,2}$|^(?=.*\d)(?:\d{1,2} )?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? ?\d{0,2}(?:,? ?\d{4})?$/i;
export const looksLikeDateColumn = cachedPerObject(
  (column: ColumnHolds) =>
    measureOfColumn(column) === null &&
    column.kind !== 'checkbox' &&
    (columnNameWords(column).some((word) => /^(?:dates?|day|due|deadline|eta)$/.test(word)) ||
      column.values
        .slice(0, 50)
        .some(({ value }) => value?.kind === 'text' && dateLikeTextPattern.test(value.value.slice(0, 20)))),
);
export const CROSS_MARK_EMOJI = new Set<string>([
  '❌',
  '❎',
  '\uD83D\uDEAB',
  '⛔',
  '\uD83D\uDED1',
  '✖',
  '➖',
  '\uD83D\uDC4E',
  '\uD83D\uDE45',
]);
export const emojiInText = (text: string): string[] => text.match(/\p{Extended_Pictographic}/gu) ?? [];
export const emojiInColumn = cachedPerObject(
  ({ values, optionsOfDropdown }: ColumnHolds) =>
    new Set<string>(
      [...values.map(({ value }) => String(value?.value ?? '')), ...(optionsOfDropdown ?? [])].flatMap(emojiInText),
    ),
);
export const singleWordValuesOf = cachedPerObject(
  ({ values }: ColumnHolds) =>
    new Set<string>(
      values.flatMap(({ value }) => {
        if (value?.kind !== 'text' || value.value.trim().split(/\s+/, 3).length > 2) return [];
        let [onlyWord, ...moreWords] = plainWordsOf(value.value);
        return onlyWord === undefined || moreWords.length > 0 ? [] : [onlyWord];
      }),
    ),
);
export const unassignedPhraseLengthAt = (words: readonly TypedWord[], at: number): number => {
  let length = UNASSIGNED_PHRASES.find((phrase) => wordsMatchAt(words, at, phrase))?.length ?? 0;
  return words[at + length - 1]?.plain === 'assigned' && words[at + length]?.plain === 'to' ? 0 : length;
};
export const isOnlyTextColumn = ({ columns: [onlyColumn] }: Pick<TableHolds, 'columns'>, column: ColumnHolds): boolean =>
  column === onlyColumn && column.kind === 'text' && !isPeopleColumn(column);
export const MOST_LISTED_VALUES = 12;
export const isColumnOfFewValues = (column: ColumnHolds): boolean =>
  column.optionsOfDropdown !== null ||
  column.kind === 'fewWords' ||
  isPeopleColumn(column) ||
  (column.kind === 'text' &&
    !column.areMoreValuesLeftOut &&
    column.values.length <= MOST_LISTED_VALUES &&
    column.values.some(({ value, records }) => value !== null && records > 1));
export const NUMBER_SIGN_OR_HYPHEN_PATTERN = /(?<=\d)[-+−]+(?!\S)|(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu;
export const PLAINLY_TYPED_PATTERN = /^(?!.*(?:\.\.|\b(?:plus|minus)\b))[\p{L}\p{N}\s,/&'’"“”()?!.]*$/isu;
export const valueLabelsCache = new WeakMap<ColumnHolds, ValueLabel[]>();
export const COMMAND_WORD_SETS = [
  COMMAND_WORDS,
  TASK_NOUNS,
  BLANK_WORDS,
  FILLED_WORDS,
  QUESTION_FILLER_WORDS,
  DATE_CONDITION_WORDS,
  NUMBER_CONDITION_WORDS,
  TEXT_TEST_WORDS,
  LARGEST_SMALLEST_WORDS,
];
export const NON_NAME_WORD_SETS = [
  ...COMMAND_WORD_SETS.filter((wordSet) => wordSet !== QUESTION_FILLER_WORDS),
  CHECKED_RULE_WORDS,
  UNCHECKED_WORDS,
  WORDS_NOT_TAKEN_AS_VALUES,
  new Set<string>(UNASSIGNED_PHRASES.flat()),
];
export const pluralFormsOf = (word: string): string[] =>
  [word, `${word}s`, `${word}es`].concat(word.endsWith('y') ? `${word.slice(0, -1)}ies` : []);
export const leadingNameWordsOf = cachedPerObject(
  (column: ColumnHolds) =>
    new Set<string>(
      [plainWordsOf(column.name ?? ''), ...valueLabelsOf(column).map((label) => label.words)].flatMap(
        (words) => words.slice(0, -1),
      ),
    ),
);
export const valuesNamedCache = new WeakMap<TableHolds, WeakMap<readonly TypedWord[], Map<string, ValueNamed[]>>>();
