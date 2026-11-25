import type { CellCondition, ColumnId, SortDirection, ValueContents } from '@open-artifact/sheets-core';
import type { ColumnHolds, TableHolds, WordsReadAsFilter } from '../state/initial-state.ts';
import type { SortKeyOfColumn } from '../state/event-reducer.ts';
import type { SignsOfNumbers } from '../model/workbook.ts';
import type { FilterLine } from '../tables/filter-model.ts';
import type { PhraseMeaning, TypedWord } from './tokens.ts';
import type { ConditionRead } from './conditions.ts';
import type { ColumnNamed } from './column-names.ts';
import { filterEntry, filterOfEntries } from '../tables/filter-model.ts';
import { NO_WORD_TOKEN, wordsMatchAt, splitIntoWords, isWordOrItsPlural, plainWordsOf } from './tokens.ts';
import {
  ON_TOP_PHRASES,
  SUPERLATIVE_DIRECTIONS,
  SORT_KEY_JOINERS,
  TEXT_TEST_WORDS,
  NUMBER_CONDITION_WORDS,
  DATE_CONDITION_WORDS,
  MOST_CHARACTERS_OF_WORDS,
  HIDING_WORDS,
  SORT_BY_PHRASES,
  EQUALS_WORDS,
  LIST_JOINERS,
  NEGATING_WORDS,
  FIRST_PERSON_WORDS,
  LARGEST_SMALLEST_WORDS,
  COMMAND_WORDS,
  BLANK_WORDS,
  FILLED_WORDS,
  TASK_NOUNS,
  SET_STATE_WORDS,
  ALL_WORDS,
  EMPTY_WORDS,
  FILTER_FILLER_WORDS,
  NOT_VERBS,
  CHECKED_RULE_WORDS,
  UNCHECKED_WORDS,
  NON_COLUMN_SUPERLATIVES,
  AGE_SUPERLATIVES,
  DATE_SUPERLATIVES,
  MOST_DAYS_FROM_TODAY_FOR_DATES,
  RECORD_NOUNS,
  TABLE_SUBJECT_NOUNS,
  LINKING_VERBS,
  NO_WITHOUT_WORDS,
  SORT_VERBS,
  SHOW_VERBS,
  ANYONE_WORDS,
  IS_HAS_WORDS,
  POSSESSIVE_ONES_WORDS,
  EXCLUDE_VERBS,
  HAVING_WORDS,
  QUESTION_FILLER_WORDS,
  YET_WORD,
  WORDS_NOT_TAKEN_AS_VALUES,
  DUE_WORDS,
  RANK_WORDS,
  SORT_DIRECTION_PHRASES,
  RANGE_DIRECTION_PHRASES,
} from './vocabulary.ts';
import {
  columnNamedAt,
  PLAINLY_TYPED_PATTERN,
  NUMBER_SIGN_OR_HYPHEN_PATTERN,
  valueNamedAt,
  columnNamesOf,
  isColumnOfFewValues,
  valueLabelsOf,
  valuesNamedAt,
  unassignedPhraseLengthAt,
  hasZeroValues,
  isOnlyTextColumn,
  looksLikeDateColumn,
  leadingNameWordsOf,
  nameMatchesAt,
  isWordBreakAt,
  isSingleWordValueOf,
  emojiInColumn,
  emojiInText,
  CROSS_MARK_EMOJI,
} from './column-names.ts';
import { measureOfColumn, isPeopleColumn, valuesOfUserInColumn } from './column-holds.ts';
import {
  testPhraseWordCountAt,
  columnComparisonAt,
  startsNumberComparisonAt,
  readTextCondition,
  readCellTestCondition,
  readMeasureCondition,
  readEqualsNumberCondition,
} from './conditions.ts';
import { saysOverdueAt, isMonthName } from './dates.ts';
import { dateToSerial } from '../model/date-serials.ts';
import { columnNameWords } from './numbers.ts';
/** What the words ask of a column: values to show, values to hide, conditions to meet. */
export interface AsksOfColumn {
  oneOf: (ValueContents | null)[];
  noneOf: (ValueContents | null)[];
  meets: CellCondition[];
}
/** The sort keys read from the words, the column of the last one, and where the words go on. */
export interface SortKeysRead {
  keys: SortKeyOfColumn[];
  last: ColumnHolds | null;
  next: number;
}
/** How to read words as a filter. */
export interface FilterWordsSituation {
  /** Read the words as asking of this column only. */
  only?: ColumnId;
  /** Today's date, `YYYY-MM-DD`; without it no dates are read. */
  today?: string | null;
  /** Read values only after the name of their column. */
  needsHeaders?: boolean;
  signsOfNumbers?: SignsOfNumbers;
  isMonthFirst?: boolean;
}
/** What the words ask of a column at a place, and how many words it takes. */
type TestRead =
  | ({ kind: 'condition' } & ConditionRead)
  | { kind: 'values'; values: (ValueContents | null)[]; wordCount: number; isNot?: true }
  | { kind: 'viewer'; wordCount: number };
/** A condition read for a column. */
interface ConditionReadForColumn extends ConditionRead {
  column: ColumnHolds;
}
/** A word that applies to a column: `of` is the column, or `null` until one is named. */
interface WordForColumn {
  word: TypedWord;
  of: ColumnHolds | null;
}
/** A joining word, and the column named before it. */
interface JoinerAfterColumn {
  word: TypedWord;
  after: ColumnHolds | null;
}
export function filterClausesOfAsks(asksByColumn: Map<ColumnId, AsksOfColumn>): FilterLine[] {
  const clauses: FilterLine[] = [];
  for (const [
    c,
    {
      oneOf,
      noneOf,
      meets: [condition],
    },
  ] of asksByColumn) {
    const [kind, [firstValue, ...otherValues]]: ['isOneOf' | 'isNoneOf', (ValueContents | null)[]] =
      oneOf.length > 0 ? ['isOneOf', oneOf] : ['isNoneOf', noneOf];
    if (condition !== undefined)
      clauses.push(
        filterEntry(c, {
          kind: 'meets',
          condition,
        }),
      );
    else if (firstValue !== undefined)
      clauses.push(
        filterEntry(c, {
          kind,
          values: [firstValue, ...otherValues],
        }),
      );
  }
  return clauses;
}
export function readSortKeys(
  holds: TableHolds,
  words: readonly TypedWord[],
  from: number,
  notPlace: (word: TypedWord) => void,
  isDirectionOnly: boolean = false,
): SortKeysRead {
  const keys: SortKeyOfColumn[] = [];
  let lastColumn: ColumnHolds | null = null;
  let joiner: TypedWord | null = isDirectionOnly ? NO_WORD_TOKEN : (words[from - 1] ?? null);
  let at = from;
  while (at < words.length) {
    const word = words[at] ?? NO_WORD_TOKEN;
    const lastKey = joiner === null || joiner.plain === ',' ? keys.at(-1) : undefined;
    const direction = sortDirectionAt(words, at, lastColumn);
    const onTopPhrase = ON_TOP_PHRASES.find((phrase) => wordsMatchAt(words, at + 1, phrase));
    const superlativeDirection = onTopPhrase === undefined ? undefined : SUPERLATIVE_DIRECTIONS.get(word.plain);
    const named: ColumnNamed | null = joiner === null ? null : columnNamedAt(holds, words, at, true, true);
    if (lastKey !== undefined && direction !== undefined) {
      keys[keys.length - 1] = {
        ...lastKey,
        direction: direction[1],
      };
      joiner = null;
      at += direction[0].length;
    } else if (lastKey !== undefined && superlativeDirection !== undefined && lastColumn !== null && isSuperlativeFor(lastColumn, word.plain)) {
      keys[keys.length - 1] = {
        ...lastKey,
        direction: superlativeDirection,
      };
      joiner = null;
      at += 1 + (onTopPhrase?.length ?? 0);
    } else if (named !== null && keys.every(({ c }) => c !== named.column.c)) {
      keys.push({
        c: named.column.c,
        direction: 'ascending',
      });
      [lastColumn, joiner] = [named.column, null];
      at += named.wordCount;
    } else {
      let isColumnWord = word.plain === 'column' || (word.plain === 'date' && lastColumn?.kind === 'date');
      if (joiner === null && SORT_KEY_JOINERS.has(word.plain)) joiner = word;
      else if (!(joiner === null ? isColumnWord : SORT_LIST_WORDS.has(word.plain))) break;
      at += 1;
    }
  }
  const endsWithAnd = keys.length > 0 && at < words.length && joiner?.plain === 'and';
  if (joiner !== null && joiner.plain !== ',' && !endsWithAnd) notPlace(joiner);
  return {
    keys,
    last: lastColumn,
    next: at,
  };
}
export function knownWordsForColumn(column: ColumnHolds | null, today: string | null): Set<string> | null {
  if (column === null || column.kind === 'checkbox') return null;
  let measure = measureOfColumn(column);
  if (measure === null) return TEXT_TEST_WORDS;
  if (measure === 'numbers') return NUMBER_CONDITION_WORDS;
  return today === null ? null : DATE_CONDITION_WORDS;
}
export function readWordsAsFilter(
  typed: string,
  holds: TableHolds,
  viewerId: string | null,
  { only: onlyC, today = null, needsHeaders = false, signsOfNumbers, isMonthFirst = true }: FilterWordsSituation = {},
): WordsReadAsFilter {
  if (typed.length > MOST_CHARACTERS_OF_WORDS) return FILTER_WORDS_NOT_READ;
  const isTypedPlainly = PLAINLY_TYPED_PATTERN.test(typed.replace(NUMBER_SIGN_OR_HYPHEN_PATTERN, ''));
  const onlyColumn = onlyC === undefined ? null : (holds.columns.find(({ c }) => c === onlyC) ?? null);
  if (onlyC !== undefined && onlyColumn === null) return FILTER_WORDS_NOT_READ;
  const words = splitIntoWords(typed, onlyColumn === null, signsOfNumbers);
  const wordsNotPlacedSet = new Set<TypedWord>();
  const notPlaced = {
    push: (...unplaced: TypedWord[]) => unplaced.forEach((word) => wordsNotPlacedSet.add(word)),
  };
  const isDecimalComma = signsOfNumbers?.decimalSign === 'comma';
  const isGroupNotPoint = isDecimalComma && signsOfNumbers.groupSign !== 'point';
  const isGroupSpace = isDecimalComma && signsOfNumbers.groupSign.endsWith('Space');
  const numberWordsInDoubt = new Set<TypedWord>();
  const doubtNumberWords = (...doubted: TypedWord[]) => {
    doubted.forEach((word) => numberWordsInDoubt.add(word));
    notPlaced.push(...doubted);
  };
  for (const [at, word] of words.entries()) {
    let [wordBefore, wordAfter] = [words[at - 1] ?? NO_WORD_TOKEN, words[at + 1] ?? NO_WORD_TOKEN];
    if (isGroupNotPoint && /^-?(?!0)\d{1,3}(?:\.\d{3})+$/.test(word.said)) doubtNumberWords(word);
    let isDigitJustAfter = !wordAfter.isAfterBlank && /^\d/.test(wordAfter.said);
    let isNumberJustBefore = !word.isAfterBlank && isNumberSaid(wordBefore);
    if (isDecimalComma && word.said === ',' && isDigitJustAfter && isNumberJustBefore && (isNumberSaid(wordAfter) || /[.,]/.test(wordBefore.said)))
      doubtNumberWords(wordBefore, word, wordAfter);
    else if (isDecimalComma && word.said === ',' && isDigitJustAfter && isNumberSaid(wordAfter)) notPlaced.push(word, wordAfter);
    let isShortNumberLast =
      !isGroupNotPoint &&
      wordAfter === words.at(-1) &&
      wordAfter.tail === '' &&
      /^\d{1,2}$/.test(wordAfter.said) &&
      /^-?[1-9]\d{0,2}(?:\.\d{3})*$/.test(word.said);
    let isPointBetweenNumbers =
      isDecimalComma &&
      wordAfter.gap === '.' &&
      isNumberSaid(word) &&
      (isNumberSaid(wordAfter) || (/[.,]/.test(word.said) && /^\d/.test(wordAfter.said)));
    if (isPointBetweenNumbers && isShortNumberLast) notPlaced.push(wordAfter);
    else if (isPointBetweenNumbers) doubtNumberWords(word, wordAfter);
    if (isGroupSpace && /^\d{1,3}$/.test(word.said) && /^\s+$/.test(wordAfter.gap) && /^\d{3},\d+$/.test(wordAfter.said))
      doubtNumberWords(word, wordAfter);
    let isNumberAfter = !wordAfter.isAfterBlank && /^\d+$/.test(wordAfter.plain);
    let isNumberBefore = !word.isAfterBlank && /^\d+$/.test(wordBefore.plain);
    if (!isMonthFirst && word.said === '/' && isNumberBefore && isNumberAfter) notPlaced.push(word);
  }
  const asksByColumn = new Map<ColumnId, AsksOfColumn>();
  let sortBy: SortKeyOfColumn[] = [];
  let pendingSortVerb: TypedWord | null = null;
  let asksForAll = false;
  // Closures below assign `negation`, `lastColumn` and `currentColumn`; the `as` keeps the checker
  // from taking them to stay `null` in the loop that calls those closures.
  let negation = null as WordForColumn | null;
  let havingWord: TypedWord | null = null;
  let pendingJoiner: JoinerAfterColumn | null = null;
  let hidingWord: WordForColumn | null = null;
  let wasColumnTouched = false;
  const noteColumnTouched = (column: ColumnHolds) => {
    wasColumnTouched = true;
    if (hidingWord !== null && hidingWord.of !== null && hidingWord.of !== column) notPlaced.push(hidingWord.word);
    if (hidingWord !== null)
      hidingWord = {
        ...hidingWord,
        of: column,
      };
  };
  let yetWord: TypedWord | null = null;
  let lastColumn = null as ColumnHolds | null;
  let currentColumn = null as ColumnHolds | null;
  let columnOfLastTest: ColumnHolds | null = null;
  const addValuesFor = (column: ColumnHolds, values: (ValueContents | null)[], asNoneOf?: boolean) => {
    noteColumnTouched(column);
    if (column !== columnOfLastTest) columnOfLastTest = null;
    if (pendingJoiner !== null && pendingJoiner.after !== null && pendingJoiner.after !== column) notPlaced.push(pendingJoiner.word);
    if (negation !== null && negation.of !== null && negation.of !== column) negation = null;
    const asks = asksByColumn.get(column.c) ?? {
      oneOf: [],
      noneOf: [],
      meets: [],
    };
    asksByColumn.set(column.c, asks);
    const list = (asNoneOf ?? negation !== null) ? asks.noneOf : asks.oneOf;
    const keys = new Set(list.map(filterValueKey));
    for (const value of values) {
      if (!keys.has(filterValueKey(value))) list.push(value);
      keys.add(filterValueKey(value));
    }
    if (negation !== null)
      negation = {
        ...negation,
        of: column,
      };
    [havingWord, pendingJoiner, lastColumn, currentColumn] = [null, null, column, column];
  };
  const resetCurrentColumn = () => {
    [currentColumn, columnOfLastTest] = [null, null];
    if (negation !== null && negation.of !== null) negation = null;
  };
  const noteNegation = (word: TypedWord) => {
    if (negation !== null && negation.of === null) notPlaced.push(negation.word);
    negation = {
      word,
      of: null,
    };
    currentColumn = null;
    if (hidingWord !== null && word.plain === 'except') notPlaced.push(word);
    if (HIDING_WORDS.has(word.plain))
      hidingWord ??= {
        word,
        of: null,
      };
  };
  const isNegated = (column: ColumnHolds) => negation !== null && negation.of === column;
  const noteJoiner = (word: TypedWord) => {
    if (negation !== null && negation.of === null) notPlaced.push(negation.word);
    if (word.said === '/' && /\/\s*\d/.test(lastColumn?.name ?? '')) notPlaced.push(word);
    if (word.plain === 'or')
      pendingJoiner = {
        word,
        after: lastColumn,
      };
    if (word.plain === 'or' && lastColumn === null) notPlaced.push(word);
  };
  const addCondition = (column: ColumnHolds, condition: CellCondition) => {
    noteColumnTouched(column);
    if (pendingJoiner !== null) notPlaced.push(pendingJoiner.word);
    const negationWord = negation !== null && negation.of === null ? negation.word : null;
    const negatedCondition: CellCondition | null =
      condition.kind === 'numberIs' && condition.comparison === 'equalTo'
        ? {
            ...condition,
            comparison: 'notEqualTo',
          }
        : condition.kind === 'textContains'
          ? {
              ...condition,
              kind: 'textDoesNotContain',
            }
          : condition.kind === 'textIs'
            ? {
                ...condition,
                kind: 'textIsNot',
              }
            : null;
    if (negationWord !== null && negatedCondition === null) notPlaced.push(negationWord);
    const asks = asksByColumn.get(column.c) ?? {
      oneOf: [],
      noneOf: [],
      meets: [],
    };
    asksByColumn.set(column.c, asks);
    asks.meets.push(negationWord !== null && negatedCondition !== null ? negatedCondition : condition);
    [negation, havingWord, pendingJoiner, lastColumn, currentColumn] = [null, null, null, column, null];
  };
  const endClause = () => {
    if (negation !== null && negation.of === null) notPlaced.push(negation.word);
    if (havingWord !== null) notPlaced.push(havingWord);
    if (pendingJoiner !== null) notPlaced.push(pendingJoiner.word);
    [negation, havingWord, pendingJoiner, lastColumn, currentColumn, columnOfLastTest] = [null, null, null, null, null, null];
  };
  const addSortKeys = (keys: SortKeyOfColumn[], from: number, to: number) => {
    endClause();
    if (sortBy.length > 0) notPlaced.push(...words.slice(from, to));
    sortBy = [...sortBy, ...keys];
  };
  const startsSortByAt = (at: number) => {
    const phrase = SORT_BY_PHRASES.find((sortByPhrase) => wordsMatchAt(words, at, sortByPhrase));
    return phrase !== undefined && columnNamedAt(holds, words, at + phrase.length, true, true) !== null;
  };
  const startsColumnTestAt = (at: number) => {
    const named = columnNamedAt(holds, words, at, true);
    if (named === null) return false;
    let testAt = at + named.wordCount;
    while (EQUALS_WORDS.has(words[testAt]?.plain ?? '')) testAt += 1;
    return (
      testPhraseWordCountAt(words, testAt) > 0 ||
      columnComparisonAt(words, testAt, named.column) !== null ||
      sortDirectionAt(words, testAt, named.column) !== undefined ||
      (columnNamedAt(holds, words, at) !== null && readTestFor(named.column, testAt) !== null)
    );
  };
  const endsTextAt = (at: number) => {
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    if (plain === ',' || startsColumnTestAt(at)) return true;
    const nextAt = at + 1;
    return (
      LIST_JOINERS.has(plain) &&
      (startsColumnTestAt(nextAt) ||
        valueNamedAt(holds, words, nextAt, {
          only: null,
          rather: null,
          wholeLabelsOnly: true,
        }) !== null)
    );
  };
  const mayBeUnfinishedNameAt = (at: number) => {
    const plainWords = words.slice(at).map(({ plain }) => plain);
    const lastPlain = plainWords.at(-1);
    if (lastPlain === undefined) return true;
    return [
      ...columnNamesOf(holds.columns).map(({ name }) => name),
      ...holds.columns
        .filter(isColumnOfFewValues)
        .flatMap((column) => valueLabelsOf(column).map((label) => label.words)),
    ].some(
      (nameWords) =>
        nameWords.length >= plainWords.length &&
        plainWords.slice(0, -1).every((plain, index) => plain === nameWords[index]) &&
        nameWords[plainWords.length - 1]?.startsWith(lastPlain) === true,
    );
  };
  const stopsTextAt = (at: number, isQuoted: boolean) => {
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    if (plain === 'or' || plain === 'but' || NEGATING_WORDS.has(plain) || FIRST_PERSON_WORDS.has(plain)) return true;
    if (startsNumberComparisonAt(words, at) || startsSortByAt(at)) return true;
    if (LARGEST_SMALLEST_WORDS.has(plain) && /^\d/.test(words[at + 1]?.plain ?? '')) return true;
    if (LIST_JOINERS.has(plain) && (columnNamedAt(holds, words, at + 1, true) !== null || mayBeUnfinishedNameAt(at + 1))) return true;
    return at === words.length - 1 && !/\s$/.test(typed) && !isQuoted && 'and'.startsWith(plain);
  };
  const readTextOrColumnTest = (column: ColumnHolds, at: number): ConditionRead | null => {
    if (column.kind === 'checkbox') return null;
    const comparison = columnComparisonAt(words, at, column);
    const testWordCount = Math.max(testPhraseWordCountAt(words, at), comparison?.wordCount ?? 0);
    for (let wordAt = at; wordAt < at + testWordCount; wordAt += 1)
      if (
        columnNamedAt(holds, words, wordAt) !== null ||
        valuesNamedAt(holds, words, wordAt, {
          only: onlyColumn,
          rather: null,
          wholeLabelsOnly: true,
        }).length > 0
      )
        return null;
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    const isNotText =
      testWordCount === 0 &&
      (!/^\p{L}/u.test(plain) ||
        [COMMAND_WORDS, BLANK_WORDS, FILLED_WORDS, TASK_NOUNS, NUMBER_CONDITION_WORDS, DATE_CONDITION_WORDS].some(
          (wordSet) => wordSet.has(plain) && !SET_STATE_WORDS.has(plain),
        ) ||
        columnNamedAt(holds, words, at, true)?.isPart === false ||
        valuesNamedAt(holds, words, at, {
          only: onlyColumn,
          rather: null,
          wholeLabelsOnly: true,
        }).length > 0);
    const test =
      (measureOfColumn(column) !== null || isNotText ? null : readTextCondition(words, at, endsTextAt, stopsTextAt)) ??
      readCellTestCondition(words, at);
    if (test !== null) return test;
    const otherColumn = comparison === null ? null : columnNamedAt(holds, words, at + comparison.wordCount, true, true);
    if (comparison === null || otherColumn === null || otherColumn.column === column) return null;
    if (measureOfColumn(otherColumn.column) !== measureOfColumn(column)) return null;
    return {
      condition: {
        kind: 'numberIs',
        comparison: comparison.meant,
        operand: {
          kind: 'sameRowInColumn',
          c: otherColumn.column.c,
        },
      },
      wordCount: comparison.wordCount + otherColumn.wordCount,
    };
  };
  const readTestFor = (column: ColumnHolds, at: number): TestRead | null => {
    const condition = readMeasureCondition(words, at, column, today);
    if (condition !== null)
      return {
        kind: 'condition',
        ...condition,
      };
    const valueNamed = valueNamedAt(holds, words, at, {
      only: column,
      rather: null,
    });
    if (valueNamed !== null)
      return {
        kind: 'values',
        values: valueNamed.values,
        wordCount: valueNamed.wordCount,
      };
    if (onlyColumn === null && wordsMatchAt(words, at, ['set', 'to']) && words[at]?.isInQuotes !== true) {
      const setToTest = readTestFor(column, at + 2);
      if (setToTest !== null)
        return {
          ...setToTest,
          wordCount: setToTest.wordCount + 2,
        };
      const setToValue = valueNamedAt(holds, words, at + 1, {
        only: column,
        rather: null,
      });
      if (setToValue !== null)
        return {
          kind: 'values',
          values: setToValue.values,
          wordCount: setToValue.wordCount + 1,
        };
      const isNegatedOrAll =
        [NEGATING_WORDS, ALL_WORDS].some((wordSet) => wordSet.has(words[at + 2]?.plain ?? '')) ||
        words[at + 2]?.plain === 'anything';
      if (!namesSomethingAt(at + 1) && !isNegatedOrAll) return null;
    }
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    if (FIRST_PERSON_WORDS.has(plain) && isPeopleColumn(column))
      return {
        kind: 'viewer',
        wordCount: 1,
      };
    const unassignedLength = isPeopleColumn(column) ? unassignedPhraseLengthAt(words, at) : 0;
    if (unassignedLength > 0)
      return {
        kind: 'values',
        values: [null],
        wordCount: unassignedLength,
      };
    const isSetState = SET_STATE_WORDS.has(plain) && (onlyColumn !== null || words[at]?.isInQuotes === true);
    const isAnythingBut = plain === 'anything' && words[at + 1]?.plain === 'but';
    const isBlankOrFilled = column.kind !== 'checkbox' && !isSetState && !isAnythingBut;
    if (isBlankOrFilled && BLANK_WORDS.has(plain))
      return {
        kind: 'values',
        values: [null],
        wordCount: 1,
      };
    if (isBlankOrFilled && FILLED_WORDS.has(plain))
      return {
        kind: 'values',
        values: [null],
        wordCount: 1,
        isNot: true,
      };
    const equalsNumber = readEqualsNumberCondition(words, at, column);
    return equalsNumber === null
      ? null
      : {
          kind: 'condition',
          ...equalsNumber,
        };
  };
  const readAnyTestFor = (column: ColumnHolds, at: number): TestRead | null => {
    const test = readTestFor(column, at);
    if (test !== null || onlyColumn !== null) return test;
    const textTest = readTextOrColumnTest(column, at);
    return textTest === null
      ? null
      : {
          kind: 'condition',
          ...textTest,
        };
  };
  let unreadConditionWord = NO_WORD_TOKEN;
  const placeTest = (column: ColumnHolds, test: TestRead, at: number) => {
    const values = test.kind === 'viewer' ? valuesOfUserInColumn(column, viewerId) : test.kind === 'values' ? test.values : [];
    const includesBlank = test.kind === 'values' && test.isNot !== true && values.includes(null) && !EMPTY_WORDS.has(words[at]?.plain ?? '');
    if (onlyColumn === null && includesBlank && hasZeroValues(column)) notPlaced.push(...words.slice(at, at + 1));
    if (test.kind === 'condition' && test.condition !== null) addCondition(column, test.condition);
    else if (test.kind === 'condition') {
      unreadConditionWord = words[at + test.wordCount - 1] ?? NO_WORD_TOKEN;
      notPlaced.push(unreadConditionWord);
    } else if (values.length === 0) notPlaced.push(...words.slice(at + test.wordCount - 1, at + test.wordCount));
    else if (test.kind === 'values' && test.isNot === true) {
      if (negation !== null && negation.of === column) notPlaced.push(...words.slice(at, at + 1));
      const isNegatedHere = negation !== null && negation.of === null;
      negation = null;
      addValuesFor(column, values, !isNegatedHere);
    } else addValuesFor(column, values);
    return at + test.wordCount;
  };
  const wordsNamingColumns = new Set<TypedWord>();
  const partialValueWords = new Set<TypedWord>();
  let columnForKnownWords = onlyColumn;
  let stopsReading = false;
  const notPlace = (word: TypedWord) => {
    notPlaced.push(word);
    if (NUMBER_CONDITION_WORDS.has(word.plain) || DATE_CONDITION_WORDS.has(word.plain)) stopsReading = true;
  };
  const isLongerDateReading = (column: ColumnHolds, at: number, test: TestRead | null) => {
    if (test?.kind !== 'condition') return false;
    const longerTest = readMeasureCondition(words, at, column, today);
    return longerTest?.wordCount === test.wordCount + 1 && JSON.stringify(longerTest.condition) !== JSON.stringify(test.condition);
  };
  const readForColumn = (column: ColumnHolds, at: number) => {
    const word = words[at] ?? NO_WORD_TOKEN;
    const test = readAnyTestFor(column, at);
    const named = columnNamedAt(holds, words, at);
    if (named !== null && (test === null || test.wordCount < named.wordCount)) {
      const afterName = at + named.wordCount;
      if (named.column !== column || isLongerDateReading(column, afterName - 1, readAnyTestFor(column, afterName)))
        notPlaced.push(...words.slice(at, afterName));
      return afterName;
    }
    if (word.isAfterHyphen) notPlaced.push(word);
    if (test !== null) return placeTest(column, test, at);
    if (NEGATING_WORDS.has(word.plain)) noteNegation(word);
    else if (LIST_JOINERS.has(word.plain)) noteJoiner(word);
    else {
      if (ALL_WORDS.has(word.plain)) asksForAll = true;
      else if (!FILTER_FILLER_WORDS.has(word.plain) || isRangeWordFor(word, column)) notPlace(word);
      resetCurrentColumn();
    }
    return at + 1;
  };
  const readLargestBy = (at: number): ConditionReadForColumn | null => {
    for (const column of holds.columns) {
      const largest = measureOfColumn(column) === 'numbers' ? readMeasureCondition(words, at, column, today) : null;
      const kind = largest?.condition?.kind;
      if (largest === null || (kind !== 'isAmongTheLargest' && kind !== 'isAmongTheSmallest')) continue;
      const afterLargest = at + largest.wordCount;
      const byColumn = words[afterLargest]?.plain === 'by' ? columnNamedAt(holds, words, afterLargest + 1) : null;
      const wordAfter = words[afterLargest + 1 + (byColumn?.wordCount ?? 0)]?.plain;
      if (byColumn?.column === column && (wordAfter === undefined || LIST_JOINERS.has(wordAfter)))
        return {
          ...largest,
          column,
          wordCount: largest.wordCount + 1 + byColumn.wordCount,
        };
    }
    return null;
  };
  const columnTestAt = (at: number): ColumnNamed | null => {
    const named = columnNamedAt(holds, words, at, true, true);
    if (named === null) return null;
    let testAt = at + named.wordCount;
    if (sortDirectionAt(words, testAt, named.column) !== undefined) return named;
    while (EQUALS_WORDS.has(words[testAt]?.plain ?? '')) testAt += 1;
    if (NEGATING_WORDS.has(words[testAt]?.plain ?? '') && readTextOrColumnTest(named.column, testAt) === null) testAt += 1;
    return readTextOrColumnTest(named.column, testAt) !== null || (named.isPart && readMeasureCondition(words, testAt, named.column, today) !== null)
      ? named
      : null;
  };
  const valuesNamedHere = (at: number) =>
    valuesNamedAt(holds, words, at, {
      only: null,
      rather: null,
    });
  const namesSomethingAt = (at: number) => columnNamedAt(holds, words, at, true) !== null || valuesNamedHere(at).length > 0;
  const namesPersonAt = (at: number) => {
    const nameAt = words[at]?.plain === 'to' ? at + 1 : at;
    const valueNamed = valueNamedAt(holds, words, nameAt, {
      only: null,
      rather: null,
    });
    return (
      FIRST_PERSON_WORDS.has(words[nameAt]?.plain ?? '') ||
      unassignedPhraseLengthAt(words, nameAt) > 0 ||
      (valueNamed !== null && isPeopleColumn(valueNamed.column))
    );
  };
  const columnToTestAt = (at: number) => {
    const named = columnNamedAt(holds, words, at);
    if (named === null || named.column.kind === 'checkbox' || isOnlyTextColumn(holds, named.column)) return null;
    const saysDate = named.column.kind === 'date' && words[at + named.wordCount]?.plain === 'date';
    return startsColumnTestAt(at)
      ? null
      : {
          ...named,
          wordCount: named.wordCount + Number(saysDate),
        };
  };
  const readCheckboxWords = (at: number) => {
    let next = at;
    while (EQUALS_WORDS.has(words[next]?.plain ?? '')) next += 1;
    const hadEqualsWord = next > at;
    const notBefore =
      NOT_VERBS.has(words[next]?.plain ?? '') &&
      (CHECKED_RULE_WORDS.has(words[next + 1]?.plain ?? '') || UNCHECKED_WORDS.has(words[next + 1]?.plain ?? ''))
        ? words[next]
        : undefined;
    if (notBefore !== undefined) next += 1;
    const said =
      columnNamedAt(holds, words, next) !== null || valuesNamedHere(next).some(({ wordCount }) => wordCount > 1)
        ? NO_WORD_TOKEN
        : (words[next] ?? NO_WORD_TOKEN);
    const endsHere =
      words[next + 1] === undefined ||
      LIST_JOINERS.has(words[next + 1]?.plain ?? '') ||
      SORT_BY_PHRASES.some((phrase) => wordsMatchAt(words, next + 1, phrase));
    const isUnassigned = unassignedPhraseLengthAt(words, next) > 0 && !namesSomethingAt(next + 1);
    const nextColumn = columnNamedAt(holds, words, next + 1);
    const isSetCheckbox =
      nextColumn !== null &&
      words[next + 1 + nextColumn.wordCount]?.plain === 'set' &&
      readAnyTestFor(nextColumn.column, next + 1 + nextColumn.wordCount)?.wordCount === 1;
    const isNoBeforeName = said.plain === 'no' && !hadEqualsWord && (columnToTestAt(next + 1) !== null || isSetCheckbox || isUnassigned);
    const isNoOfEither = said.plain === 'no' && !hadEqualsWord && !endsHere && !isNoBeforeName;
    const isOfBoxes = CHECKED_RULE_WORDS.has(said.plain) || (UNCHECKED_WORDS.has(said.plain) && !isNoBeforeName);
    return {
      next,
      notBefore,
      said,
      isOfBoxes,
      isNoOfEither,
    };
  };
  const saysBoxesAt = (at: number) => {
    const { next, isOfBoxes } = readCheckboxWords(at);
    return isOfBoxes && !namesSomethingAt(next);
  };
  const readSortAt = (at: number, isDirectionOnly: boolean = false) => {
    const {
      keys,
      last: lastSortColumn,
      next,
    } = readSortKeys(holds, words, at, (word) => notPlaced.push(word), isDirectionOnly);
    if (isDirectionOnly && next === at) notPlaced.push(...words.slice(at, at + 1));
    addSortKeys(keys, at, next);
    const wordAfter = words[next];
    if (
      wordAfter !== undefined &&
      lastSortColumn !== null &&
      !LIST_JOINERS.has(words[next - 1]?.plain ?? '') &&
      (readAnyTestFor(lastSortColumn, next) !== null || isFillerWord(wordAfter))
    )
      notPlaced.push(wordAfter);
    return isDirectionOnly ? Math.max(next, at + 1) : next;
  };
  const readSuperlativeAt = (at: number) => {
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    const direction = SUPERLATIVE_DIRECTIONS.get(plain);
    if (direction === undefined) return null;
    const named = columnNamedAt(holds, words, at + 1, true, true);
    const saysDate = named?.column.kind === 'date' && words[at + 1 + named.wordCount]?.plain === 'date';
    const wordCount = 1 + (named?.wordCount ?? 0) + Number(saysDate);
    const onTopPhrase = ON_TOP_PHRASES.find((phrase) => wordsMatchAt(words, at + wordCount, phrase));
    const [column, ...otherColumns] = holds.columns.filter((candidate) => isSuperlativeFor(candidate, plain));
    const isTested = (asksByColumn.get(column?.c ?? '')?.meets.length ?? 0) > 0;
    const fitsAlone =
      otherColumns.length === 0 &&
      !NON_COLUMN_SUPERLATIVES.has(plain) &&
      (isTested || !AGE_SUPERLATIVES.has(plain)) &&
      !holds.columns.some(isRankColumn) &&
      !(DATE_SUPERLATIVES.has(plain) && holds.columns.some(looksLikeDateColumn));
    const sortColumn = named === null ? (fitsAlone ? column : undefined) : named.column;
    const isAlsoNamedValue = named !== null && valuesNamedHere(at + 1).length > 0;
    if (onTopPhrase === undefined || sortColumn === undefined || !isSuperlativeFor(sortColumn, plain) || isAlsoNamedValue) return null;
    return {
      key: {
        c: sortColumn.c,
        direction,
      },
      wordCount: wordCount + onTopPhrase.length,
    };
  };
  const bareConditionAt = (at: number): ConditionReadForColumn | null => {
    const { plain } = words[at] ?? NO_WORD_TOKEN;
    if (!/^[\d.<>≤≥$€£¥]/.test(plain) && !NUMBER_CONDITION_WORDS.has(plain) && !DATE_CONDITION_WORDS.has(plain)) return null;
    const saysOverdue = saysOverdueAt(words, at);
    let readings: ConditionReadForColumn[] = [];
    for (const column of holds.columns) {
      if (saysOverdue && !isDueColumn(column)) continue;
      const reading = readMeasureCondition(words, at, column, today);
      if (reading?.condition?.kind === 'isAmongTheLargest' || reading?.condition?.kind === 'isAmongTheSmallest') continue;
      if (reading === null || reading.wordCount < (readings[0]?.wordCount ?? 0)) continue;
      readings =
        reading.wordCount === readings[0]?.wordCount
          ? [
              ...readings,
              {
                ...reading,
                column,
              },
            ]
          : [
              {
                ...reading,
                column,
              },
            ];
    }
    const [only, ...others] = readings;
    if (only === undefined || others.length > 0) return null;
    const slice = words.slice(at, at + only.wordCount);
    const [lastWord, wordAfter] = [slice.at(-1) ?? NO_WORD_TOKEN, words[at + only.wordCount] ?? NO_WORD_TOKEN];
    if (
      slice.some(
        (word) =>
          valuesNamedHere(word.at).length > 0 ||
          holds.columns.some((column) => isPeopleColumn(column) && leadingNameWordsOf(column).has(word.plain)) ||
          (word.plain.length > 2 &&
            columnNamesOf(holds.columns).some(
              ({ column, name }) => column !== only.column && name.includes(word.plain),
            )),
      )
    )
      return null;
    if (only.column.kind === 'date') {
      if (lastWord === words.at(-1) && !/\s$/.test(typed) && /^\p{L}/u.test(lastWord.plain) && mayBeUnfinishedNameAt(lastWord.at)) return null;
      const saysMonthOrSlash =
        slice.some((word) => isMonthName(word.plain) || word.said === '/') &&
        !slice.some((word) => /^\d{4}$/.test(word.plain));
      const isNearToday =
        today !== null &&
        numbersOfCondition(only.condition).some(
          (dayNumber) => Math.abs(dayNumber - dateToSerial(today)) <= MOST_DAYS_FROM_TODAY_FOR_DATES,
        );
      const isNearDates =
        only.column.areMoreValuesLeftOut ||
        (today !== null &&
          only.column.values.some(
            ({ value }) => value?.kind === 'number' && Math.abs(value.value - dateToSerial(today)) <= 366,
          ));
      return (saysMonthOrSlash && !isNearToday) || plain === 'starting' || !isNearDates || holds.columns.some(looksLikeDateColumn) ? null : only;
    }
    const letterWords = slice.filter((word) => /^\p{L}/u.test(word.plain) && !NUMBER_CONDITION_WORDS.has(word.plain));
    const named = columnNamedAt(holds, words, letterWords[0]?.at ?? -1, true, true);
    const namesOtherColumn = letterWords.length > 0 && (named?.column !== only.column || named.wordCount !== letterWords.length);
    const isFollowedByNoun =
      [RECORD_NOUNS, TABLE_SUBJECT_NOUNS, TASK_NOUNS, FIRST_PERSON_WORDS].some((wordSet) => wordSet.has(wordAfter.plain)) ||
      namesSomethingAt(wordAfter.at);
    const isOverdueNear = [wordAfter.at, at - 1, at - 2].some((nearAt) => saysOverdueAt(words, nearAt));
    const isOtherCurrency =
      letterWords.length === 0 &&
      only.column.kind !== 'currency' &&
      slice.some((word) => /^[$€£¥]$/.test(word.plain)) &&
      holds.columns.some((column) => column !== only.column && measureOfColumn(column) === 'numbers');
    return namesOtherColumn || isFollowedByNoun || isOverdueNear || isOtherCurrency ? null : only;
  };
  const checkboxColumnNames = columnNamesOf(holds.columns).filter(
    ({ column, name }) => column.kind === 'checkbox' && name.length > 1,
  );
  const checkboxPhraseAt = (at: number) => {
    for (const { column, name } of checkboxColumnNames)
      for (let count = 1; count < name.length; count += 1) {
        let end = at + count;
        while (LINKING_VERBS.has(words[end]?.plain ?? '') || NOT_VERBS.has(words[end]?.plain ?? '')) end += 1;
        const [denied, ...moreDenied] = words.slice(at + count, end).filter(({ plain }) => NOT_VERBS.has(plain));
        if (
          end > at + count &&
          moreDenied.length === 0 &&
          nameMatchesAt(words, at, name.slice(0, count)) &&
          wordsMatchAt(words, end, name.slice(count))
        )
          return {
            column,
            wordCount: end + name.length - count - at,
            denied,
          };
      }
    return null;
  };
  let atAfterColumn = -1;
  for (let at = 0; at < words.length; ) {
    if (wasColumnTouched) [wasColumnTouched, atAfterColumn] = [false, at];
    if (stopsReading) {
      notPlaced.push(...words.slice(at));
      break;
    }
    if (onlyColumn !== null) {
      at = readForColumn(onlyColumn, at);
      continue;
    }
    const word = words[at] ?? NO_WORD_TOKEN;
    if (word.isAfterHyphen) notPlaced.push(word);
    const checkboxPhrase = checkboxPhraseAt(at);
    if (checkboxPhrase !== null) {
      if (checkboxPhrase.denied !== undefined) noteNegation(checkboxPhrase.denied);
      addValuesFor(checkboxPhrase.column, [CHECKED_BOOLEAN_VALUE]);
      resetCurrentColumn();
      at += checkboxPhrase.wordCount;
      continue;
    }
    const valueNamed = valueNamedAt(holds, words, at, {
      only: null,
      rather: currentColumn,
    });
    if (/[–—]/.test(word.gap) && currentColumn !== null && valueNamed?.column === currentColumn) notPlaced.push(word);
    const valueNamedHere =
      valueNamed?.wordCount === 1 && NEGATING_WORDS.has(word.plain) && (namesSomethingAt(at + 1) || namesPersonAt(at + 1)) ? null : valueNamed;
    const columnNamed = columnNamedAt(holds, words, at) ?? columnTestAt(at);
    const valueNamedSure = valueNamedHere?.isFirstName === true && columnNamed !== null ? null : valueNamedHere;
    let [testAt, negatingWord]: [number, TypedWord | null] = [at + (columnNamed?.wordCount ?? 0), null];
    if (columnNamed?.column.kind === 'date' && words[testAt]?.plain === 'date') testAt += 1;
    const afterColumn = testAt;
    while (EQUALS_WORDS.has(words[testAt]?.plain ?? '')) testAt += 1;
    const testForColumnAt = (wordAt: number): TestRead | null => {
      if (columnNamed === null) return null;
      if (!isOnlyTextColumn(holds, columnNamed.column)) return readAnyTestFor(columnNamed.column, wordAt);
      const textTest = readTextOrColumnTest(columnNamed.column, wordAt);
      return textTest === null
        ? null
        : {
            kind: 'condition',
            ...textTest,
          };
    };
    if (
      columnNamed !== null &&
      words[testAt]?.plain === 'in' &&
      testForColumnAt(testAt) === null &&
      valueNamedAt(holds, words, testAt + 1, {
        only: columnNamed.column,
        rather: null,
      }) !== null
    )
      testAt += 1;
    if (testForColumnAt(testAt) === null && NEGATING_WORDS.has(words[testAt]?.plain ?? '') && testForColumnAt(testAt + 1) !== null) {
      negatingWord = words[testAt] ?? null;
      testAt += 1;
    }
    const testRead = testForColumnAt(testAt);
    const test = columnNamed?.isPart === true && saysOverdueAt(words, testAt) && !isDueColumn(columnNamed.column) ? null : testRead;
    const isCheckboxNameEnd =
      columnNamed?.column.kind === 'checkbox' &&
      isWordOrItsPlural(words[afterColumn - 1]?.plain ?? '', plainWordsOf(columnNamed.column.name ?? '').at(-1) ?? '');
    const hasTest = test !== null || (isCheckboxNameEnd && saysBoxesAt(afterColumn));
    const isValueAsLongAsColumn = valueNamedSure !== null && columnNamed !== null && valueNamedSure.wordCount === columnNamed.wordCount;
    const isValueNameLonger =
      valueNamedHere === null &&
      columnNamed !== null &&
      (valuesNamedAt(holds, words, at, {
        only: null,
        rather: currentColumn,
      })[0]?.wordCount ?? 0) >= columnNamed.wordCount;
    const prefersColumn =
      columnNamed !== null &&
      (isValueNameLonger
        ? hasTest
        : valueNamedSure === null ||
          valueNamedSure.wordCount < columnNamed.wordCount ||
          (isValueAsLongAsColumn && (valueNamedSure.column === columnNamed.column || hasTest)));
    const sortByPhrase = SORT_BY_PHRASES.find((phrase) => wordsMatchAt(words, at, phrase));
    const largestBy = LARGEST_SMALLEST_WORDS.has(word.plain) ? readLargestBy(at) : null;
    const namesNothing = columnNamed === null && valueNamedSure === null;
    const superlative = namesNothing ? readSuperlativeAt(at) : null;
    const bareCondition = namesNothing && !needsHeaders ? bareConditionAt(at) : null;
    const sortDirectionAfter =
      lastColumn !== null && measureOfColumn(lastColumn) !== null && (asksByColumn.get(lastColumn.c)?.meets.length ?? 0) > 0 && word.plain.length > 1
        ? sortDirectionAt(words, at, lastColumn)
        : undefined;
    if (columnNamed !== null && prefersColumn) {
      const { column } = columnNamed;
      if (test !== null && isLongerDateReading(column, at + columnNamed.wordCount - 1, test)) {
        notPlaced.push(...words.slice(at, testAt + test.wordCount));
        at = testAt + test.wordCount;
        continue;
      }
      const noOrWithoutWord = negation !== null && negation.of === null && NO_WITHOUT_WORDS.has(negation.word.plain) ? negation.word : null;
      if (
        test !== null &&
        noOrWithoutWord !== null &&
        isPeopleColumn(column) &&
        testAt === afterColumn &&
        (test.kind === 'viewer' || (test.kind === 'values' && test.isNot !== true))
      ) {
        notPlaced.push(...words.slice(noOrWithoutWord.at, testAt + test.wordCount));
        negation = null;
        at = testAt + test.wordCount;
        continue;
      }
      if (test !== null) {
        if (wordsMatchAt(words, testAt, ['set', 'to'])) resetCurrentColumn();
        if (negatingWord !== null) noteNegation(negatingWord);
        at = placeTest(column, test, testAt);
        columnOfLastTest = currentColumn;
        continue;
      }
      const saysSuperlativeFirst =
        measureOfColumn(column) !== null && words[afterColumn + 1]?.plain === 'first' && SUPERLATIVE_DIRECTIONS.has(words[afterColumn]?.plain ?? '');
      if (negation === null && havingWord === null && (saysSuperlativeFirst || sortDirectionAt(words, afterColumn, column) !== undefined)) {
        at = readSortAt(at, true);
        continue;
      }
      at = afterColumn;
      const negationWord = negation !== null && negation.of === null ? negation.word : null;
      const saysNoOrWithout = negationWord !== null && NO_WITHOUT_WORDS.has(negationWord.plain);
      const isSameColumn = currentColumn === column && !LIST_JOINERS.has(words[word.at - 1]?.plain ?? '');
      if (column.kind === 'checkbox') {
        const {
          next: boxWordAt,
          notBefore,
          said: boxWord,
          isOfBoxes,
          isNoOfEither,
        } = readCheckboxWords(afterColumn);
        if ((columnNamed.isPart && !isOfBoxes) || (words[word.at - 1]?.plain === 'to' && !isCheckboxNameEnd))
          notPlaced.push(...words.slice(word.at, afterColumn));
        if (isNoOfEither) {
          const [valueAfter] = valuesNamedHere(boxWordAt + 1);
          notPlaced.push(...words.slice(boxWordAt, boxWordAt + 1 + (valueAfter?.wordCount ?? 1)));
        }
        if (isOfBoxes) {
          at = boxWordAt + 1;
          const negatingWords = [negationWord, notBefore, CHECKED_RULE_WORDS.has(boxWord.plain) ? undefined : boxWord].filter(
            (negating) => negating !== null && negating !== undefined,
          );
          if (negatingWords.length > 1) notPlaced.push(boxWord);
          else if (negationWord === null && negatingWords[0] !== undefined) noteNegation(negatingWords[0]);
        }
        addValuesFor(column, [CHECKED_BOOLEAN_VALUE]);
      } else if (isOnlyTextColumn(holds, column)) {
        if (negationWord !== null && saysNoOrWithout) notPlaced.push(negationWord);
        const nextWord = words.slice(testAt).find(({ plain }) => !NEGATING_WORDS.has(plain)) ?? NO_WORD_TOKEN;
        if (
          words
            .slice(afterColumn, nextWord.at + 1)
            .some((wordBetween) => isWordBreakAt(words, wordBetween.at) && wordBetween.said !== '-' && wordBetween.said !== '!') &&
          isSingleWordValueOf(column, nextWord.plain) &&
          namesSomethingAt(nextWord.at)
        )
          notPlaced.push(...words.slice(word.at, nextWord.at + 1));
        columnForKnownWords = column;
        resetCurrentColumn();
        continue;
      } else if (havingWord !== null && (negationWord === null || negationWord.at < havingWord.at)) {
        if (hasZeroValues(column)) notPlaced.push(havingWord);
        negation = null;
        addValuesFor(column, [null], negationWord === null);
      } else if (havingWord === null && saysNoOrWithout) {
        if (hasZeroValues(column)) notPlaced.push(negationWord);
        negation = null;
        addValuesFor(column, [null]);
      } else if (!isSameColumn) {
        notPlaced.push(...words.slice(word.at, afterColumn));
        for (const nameWord of words.slice(word.at, afterColumn)) wordsNamingColumns.add(nameWord);
        columnForKnownWords = column;
      }
      resetCurrentColumn();
    } else if (
      valueNamedSure !== null &&
      !isValueAsLongAsColumn &&
      (valueNamedSure.mayMeanMore === false ||
        (valueNamedSure.mayMeanMore === 'unlessTypedPlainly' && isTypedPlainly && valueNamedSure.isExact && negation === null) ||
        columnOfLastTest === valueNamedSure.column ||
        columnNamedAt(holds, words, at + valueNamedSure.wordCount)?.column === valueNamedSure.column)
    ) {
      addValuesFor(valueNamedSure.column, valueNamedSure.values);
      at += valueNamedSure.wordCount;
    } else if (valueNamedSure !== null) {
      notPlaced.push(...words.slice(at, at + valueNamedSure.wordCount));
      resetCurrentColumn();
      at += valueNamedSure.wordCount;
    } else if (sortByPhrase !== undefined && startsSortByAt(at)) at = readSortAt(at + sortByPhrase.length);
    else if (superlative !== null) {
      addSortKeys([superlative.key], at, at + superlative.wordCount);
      at += superlative.wordCount;
    } else if (largestBy !== null && largestBy.condition !== null) {
      addCondition(largestBy.column, largestBy.condition);
      at += largestBy.wordCount;
    } else if (bareCondition !== null) {
      const followsColumn = atAfterColumn === at && lastColumn !== null && !isPeopleColumn(lastColumn);
      if (bareCondition.column.kind === 'date' && followsColumn) notPlaced.push(word);
      at = placeTest(
        bareCondition.column,
        {
          kind: 'condition',
          ...bareCondition,
        },
        at,
      );
    } else if (sortByPhrase !== undefined) at = readSortAt(at + sortByPhrase.length);
    else if (SORT_VERBS.has(word.plain)) {
      if (columnNamedAt(holds, words, at + 1, true, true) !== null) at = readSortAt(at + 1);
      else {
        pendingSortVerb = word;
        resetCurrentColumn();
        at += 1;
      }
    } else if (sortDirectionAfter !== undefined && lastColumn !== null) {
      const sortKey = {
        c: lastColumn.c,
        direction: sortDirectionAfter[1],
      };
      addSortKeys([sortKey], at, at + sortDirectionAfter[0].length);
      at += sortDirectionAfter[0].length;
    } else {
      const [firstValueNamed] = valuesNamedAt(holds, words, at, {
        only: null,
        rather: currentColumn,
      });
      for (const valueWord of words.slice(at, at + (firstValueNamed?.wordCount ?? 0))) partialValueWords.add(valueWord);
      const saysShowMe = word.plain === 'me' && SHOW_VERBS.has(words[at - 1]?.plain ?? '');
      const isBeforeBut = words[at + 1]?.plain === 'but';
      const isAfterAllOrAnyone = ALL_WORDS.has(words[at - 1]?.plain ?? '') || ANYONE_WORDS.has(words[at - 1]?.plain ?? '');
      const uncheckedColumn = !(word.plain.startsWith('un') && word.plain.length > 5)
        ? undefined
        : holds.columns.find(
            ({ kind, name }) => kind === 'checkbox' && plainWordsOf(name ?? '').join(' ') === word.plain.slice(2),
          );
      if (word.plain === 'assigned') {
        const phraseStart = words[at - 1]?.plain === 'date' ? at - 1 : at;
        const followsBlankAsk = [1, 2, 3].some(
          (wordCount) =>
            [at, phraseStart].some((end) => {
              const named = columnNamedAt(holds, words, end - wordCount, true);
              return named?.wordCount === wordCount && asksByColumn.get(named.column.c)?.oneOf.includes(null) === true;
            }),
        );
        const isOfPeopleColumn = currentColumn !== null && isPeopleColumn(currentColumn) && !LIST_JOINERS.has(words[at - 1]?.plain ?? '');
        const namesPersonAfter = namesPersonAt(at + 1);
        if (!namesPersonAfter && !isOfPeopleColumn && !followsBlankAsk) {
          notPlace(word);
          resetCurrentColumn();
        }
        if (namesPersonAfter) resetCurrentColumn();
        at += namesPersonAfter && words[at + 1]?.plain === 'to' ? 2 : 1;
        continue;
      }
      if (uncheckedColumn !== undefined && negation === null) {
        noteNegation(word);
        addValuesFor(uncheckedColumn, [CHECKED_BOOLEAN_VALUE]);
        resetCurrentColumn();
        at += 1;
        continue;
      }
      const isNoBeforeName = (word.plain === 'no' || word.plain === 'not') && namesSomethingAt(at + 1);
      const isNotAssignedTo = word.plain === 'not' && words[at + 1]?.plain === 'assigned' && namesPersonAt(at + 2);
      const unassignedLength = isNoBeforeName || isNotAssignedTo ? 0 : unassignedPhraseLengthAt(words, at);
      const emptyColumn = EMPTY_WORDS.has(word.plain) ? columnToTestAt(at + 1) : null;
      if (unassignedLength > 0) {
        const [onlyPeopleColumn, ...otherPeopleColumns] = holds.columns.filter(isPeopleColumn);
        const peopleColumn =
          currentColumn !== null && isPeopleColumn(currentColumn) ? currentColumn : otherPeopleColumns.length === 0 ? onlyPeopleColumn : undefined;
        const wordAfterPhrase = words[at + unassignedLength];
        const endsPhrase = wordAfterPhrase === undefined || isFillerWord(wordAfterPhrase) || TASK_NOUNS.has(wordAfterPhrase.plain);
        const isFollowedByIsHas =
          IS_HAS_WORDS.has(wordAfterPhrase?.plain ?? '') || (POSSESSIVE_ONES_WORDS.has(words[at + unassignedLength - 1]?.plain ?? '') && !endsPhrase);
        if (peopleColumn === undefined || isFollowedByIsHas || isNegated(peopleColumn)) {
          notPlaced.push(...words.slice(at, at + unassignedLength));
          resetCurrentColumn();
        } else addValuesFor(peopleColumn, [null]);
        at += unassignedLength;
        continue;
      }
      if (emptyColumn !== null) {
        if (isNegated(emptyColumn.column)) {
          notPlaced.push(...words.slice(at, at + 1 + emptyColumn.wordCount));
          resetCurrentColumn();
        } else addValuesFor(emptyColumn.column, [null]);
        at += 1 + emptyColumn.wordCount;
        continue;
      }
      const isAfterOr = words[at - 1]?.plain === 'or' && currentColumn?.kind !== 'checkbox';
      if (currentColumn !== null && isAfterOr && !isNegated(currentColumn) && BLANK_WORDS.has(word.plain)) {
        addValuesFor(currentColumn, [null]);
        at += 1;
        continue;
      }
      if (FIRST_PERSON_WORDS.has(word.plain) && !saysShowMe) {
        const [viewerColumn, ...otherViewerColumns] = holds.columns.filter((candidate) => valuesOfUserInColumn(candidate, viewerId).length > 0);
        if (viewerColumn === undefined || otherViewerColumns.length > 0) notPlaced.push(word);
        else addValuesFor(viewerColumn, valuesOfUserInColumn(viewerColumn, viewerId));
      } else if (NEGATING_WORDS.has(word.plain) || EXCLUDE_VERBS.has(word.plain) || (word.plain === 'but' && isAfterAllOrAnyone)) noteNegation(word);
      else if (wordsMatchAt(words, at, ['leave', 'out'])) {
        noteNegation(word);
        at += 1;
      } else if (LIST_JOINERS.has(word.plain)) noteJoiner(word);
      else {
        const isBeforeNegation =
          NEGATING_WORDS.has(words[at + 1]?.plain ?? '') &&
          (word.plain === 'but' || HAVING_WORDS.has(word.plain)) &&
          columnNamedAt(holds, words, at + 1) === null;
        const isFillerAlsoValue =
          QUESTION_FILLER_WORDS.has(word.plain) && holds.columns.some((candidate) => isSingleWordValueOf(candidate, word.plain));
        const isButBeforeColumn = word.plain === 'but' && lastColumn !== null && !asksForAll && columnNamedAt(holds, words, at + 1) !== null;
        const isPassedOver =
          !isFillerAlsoValue && (isFillerWord(word) || TASK_NOUNS.has(word.plain) || saysShowMe || isBeforeNegation || isButBeforeColumn);
        const isToBeforeValue =
          word.plain === 'to' &&
          currentColumn !== null &&
          valueNamedAt(holds, words, at + 1, {
            only: currentColumn,
            rather: null,
          }) !== null;
        columnForKnownWords = columnNamedAt(holds, words, at, true)?.column ?? columnForKnownWords;
        if (isBeforeNegation) resetCurrentColumn();
        else if (HAVING_WORDS.has(word.plain)) havingWord = word;
        else if (ALL_WORDS.has(word.plain) || (ANYONE_WORDS.has(word.plain) && (isBeforeBut || !LIST_JOINERS.has(words[at - 1]?.plain ?? ''))))
          asksForAll = true;
        else if (!isPassedOver || isRangeWordFor(word, lastColumn) || isToBeforeValue) notPlace(word);
        if (isRangeWordFor(word, lastColumn)) columnForKnownWords = lastColumn;
        if (word.plain === YET_WORD || (word.plain === 'still' && NEGATING_WORDS.has(words[at + 1]?.plain ?? ''))) yetWord ??= word;
        resetCurrentColumn();
      }
      at += 1;
    }
  }
  endClause();
  if (pendingSortVerb !== null && sortBy.length === 0) notPlaced.push(pendingSortVerb);
  const excludesLastOption = ({ c, optionsOfDropdown }: ColumnHolds) => {
    const excludedTexts = (asksByColumn.get(c)?.noneOf ?? []).filter((value) => value?.kind === 'text');
    return excludedTexts.length === 0 || excludedTexts.some((value) => value.value === optionsOfDropdown?.at(-1));
  };
  if (yetWord !== null && !holds.columns.every((column) => isPeopleColumn(column) || excludesLastOption(column)))
    notPlaced.push(yetWord);
  const hasSeveralAsksInColumn = [...asksByColumn.values()].some(
    ({ oneOf, noneOf, meets }) => Number(oneOf.length > 0) + Number(noneOf.length > 0) + meets.length > 1,
  );
  const isEmojiOfFewValues = (emoji: string) =>
    holds.columns.some((column) => isColumnOfFewValues(column) && emojiInColumn(column).has(emoji));
  const emojiSaid = [...new Set(onlyColumn === null ? emojiInText(typed) : [])].filter(
    (emoji) => CROSS_MARK_EMOJI.has(emoji) || isEmojiOfFewValues(emoji),
  );
  const textsOfAsks = (emojiSaid.length === 0 ? [] : holds.columns).flatMap(({ c, name }) => {
    const { oneOf = [], noneOf = [], meets = [] } = asksByColumn.get(c) ?? {};
    const isAsked = asksByColumn.has(c) || sortBy.some((key) => key.c === c);
    return oneOf
      .concat(noneOf)
      .map((value) => String(value?.value ?? ''))
      .concat(
        meets.map((condition) => ('text' in condition ? condition.text : '')),
        isAsked ? (name ?? '') : '',
      );
  });
  const emojiNotPlaced = emojiSaid.filter((emoji) => !textsOfAsks.some((text) => text.includes(emoji)));
  if (wordsNotPlacedSet.size > 0 || hasSeveralAsksInColumn || emojiNotPlaced.length > 0) {
    const unplacedWords = [...wordsNotPlacedSet];
    unplacedWords.sort((one, other) => one.at - other.at);
    const isWordFinished = (word: TypedWord) => COMMAND_WORDS.has(word.plain) || word !== words.at(-1) || /\s$/.test(typed);
    const knownWords = knownWordsForColumn(columnForKnownWords, today);
    const knownWordsUsed = onlyColumn !== null && knownWords === TEXT_TEST_WORDS ? null : knownWords;
    const leadingWordSets = (onlyColumn === null ? holds.columns : [onlyColumn]).map(leadingNameWordsOf);
    const mayBeOnItsWay = (word: TypedWord) =>
      COMMAND_WORDS.has(word.plain) ||
      (onlyColumn === null && WORDS_NOT_TAKEN_AS_VALUES.has(word.plain)) ||
      wordsNamingColumns.has(word) ||
      leadingWordSets.some((leadingWords) => leadingWords.has(word.plain)) ||
      partialValueWords.has(word) ||
      (EMPTY_WORDS.has(word.plain) && word !== words.at(-1) && mayBeUnfinishedNameAt(word.at + 1)) ||
      (knownWordsUsed !== null &&
        word !== unreadConditionWord &&
        (knownWordsUsed.has(word.plain) || (knownWordsUsed !== TEXT_TEST_WORDS && /^-?[\d.]/.test(word.plain))));
    let [trailingUnplaced, wordAt] = [0, words.length - 1];
    for (; wordAt >= 0 && trailingUnplaced < unplacedWords.length; wordAt -= 1) {
      const { plain } = words[wordAt] ?? NO_WORD_TOKEN;
      if (wordsNotPlacedSet.has(words[wordAt] ?? NO_WORD_TOKEN)) trailingUnplaced += 1;
      else if (!FILTER_FILLER_WORDS.has(plain) && !LIST_JOINERS.has(plain)) break;
    }
    const isOnItsWay =
      numberWordsInDoubt.size === 0 &&
      !(isDecimalComma && unplacedWords.some(({ said }) => /^-?\d*,\d+$/.test(said))) &&
      (unplacedWords.length > 0 || (emojiNotPlaced.length > 0 && !hasSeveralAsksInColumn)) &&
      emojiNotPlaced.every(isEmojiOfFewValues) &&
      trailingUnplaced === unplacedWords.length &&
      unplacedWords.every((unplaced) => mayBeOnItsWay(unplaced) || !isWordFinished(unplaced));
    const wordGroups: TypedWord[][] = [];
    for (const unplaced of unplacedWords)
      if (wordGroups.at(-1)?.at(-1)?.at === unplaced.at - 1) wordGroups.at(-1)?.push(unplaced);
      else wordGroups.push([unplaced]);
    const isKnownWord = (word: TypedWord) =>
      !word.isInQuotes &&
      (COMMAND_WORDS.has(word.plain) ||
        wordsNamingColumns.has(word) ||
        BLANK_WORDS.has(word.plain) ||
        FILLED_WORDS.has(word.plain) ||
        word.plain === 'but' ||
        EXCLUDE_VERBS.has(word.plain) ||
        word.plain === 'assigned');
    const withEmojiNotPlaced = (texts: string[]) => [
      ...texts,
      ...emojiNotPlaced.filter((emoji) => !texts.some((text) => text.includes(emoji))),
    ];
    return {
      kind: 'notRead',
      wordsNotPlaced: withEmojiNotPlaced(wordGroups.map(textOfWords)),
      wordsNotKnown: withEmojiNotPlaced(wordGroups.filter((group) => !group.every(isKnownWord)).map(textOfWords)),
      isOnItsWay,
    };
  }
  const filter = filterOfEntries(filterClausesOfAsks(asksByColumn));
  if (filter === null && sortBy.length === 0 && !asksForAll) return FILTER_WORDS_NOT_READ;
  return {
    kind: 'read',
    asked: {
      filter,
      sortBy,
    },
  };
}
export const CHECKED_BOOLEAN_VALUE: ValueContents = {
  kind: 'boolean',
  value: true,
};
export const filterValueKey = (filterValue: ValueContents | null): string =>
  filterValue === null ? '' : `${filterValue.kind} ${filterValue.value}`;
export const isDueColumn = (column: ColumnHolds): boolean => columnNameWords(column).some((word) => DUE_WORDS.has(word));
export const numbersOfCondition = (condition: CellCondition | null): number[] =>
  (condition?.kind === 'numberIs'
    ? [condition.operand]
    : condition?.kind === 'numberIsBetween'
      ? [condition.oneEnd, condition.otherEnd]
      : []
  ).flatMap((operand) => (operand.kind === 'number' ? [operand.number] : []));
export const isRankColumn = (column: ColumnHolds): boolean => columnNameWords(column).some((word) => RANK_WORDS.has(word));
export const isSuperlativeFor = (column: ColumnHolds, superlative: string): boolean =>
  measureOfColumn(column) === (DATE_SUPERLATIVES.has(superlative) ? 'days' : 'numbers') && !isRankColumn(column);
export const sortDirectionAt = (
  words: readonly TypedWord[],
  at: number,
  column: ColumnHolds | null,
): PhraseMeaning<SortDirection> | undefined =>
  [...SORT_DIRECTION_PHRASES, ...(column !== null && measureOfColumn(column) !== null && !isRankColumn(column) ? RANGE_DIRECTION_PHRASES : [])].find(
    ([phrase]) => wordsMatchAt(words, at, phrase),
  );
export const isFillerWord = ({ plain }: TypedWord): boolean => FILTER_FILLER_WORDS.has(plain) || QUESTION_FILLER_WORDS.has(plain);
export const SORT_LIST_WORDS = new Set<string>([...SORT_KEY_JOINERS, 'by', 'the']);
export const isRangeWordFor = (word: TypedWord, column: ColumnHolds | null): boolean =>
  (word.plain === 'to' || word.isAfterHyphen) && column !== null && measureOfColumn(column) !== null;
export const textOfWords = (words: readonly TypedWord[]): string =>
  words.map(({ said, gap }, index) => (index === 0 ? said : gap + said)).join('');
export const FILTER_WORDS_NOT_READ: WordsReadAsFilter = {
  kind: 'notRead',
  wordsNotPlaced: [],
  wordsNotKnown: [],
  isOnItsWay: false,
};
export const isNumberSaid = ({ said }: TypedWord): boolean => /^-?[\d.,]*\d$/.test(said);
