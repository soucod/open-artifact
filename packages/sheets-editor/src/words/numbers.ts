import type { CellCondition, ColumnOfATable, Comparison, NumberOperand } from '@open-artifact/sheets-core';
import type { ColumnHolds } from '../state/initial-state.ts';
import type { ConditionRead } from './conditions.ts';
import type { PhraseFound, TypedWord } from './tokens.ts';
import { plainWordsOf, isWordOrItsPlural, longestPhraseAt, NO_WORD_TOKEN } from './tokens.ts';
import { NUMBER_CONDITION_WORDS } from './vocabulary.ts';
import { NUMBER_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES } from './numbers-values.ts';
export function columnNameWords(column: ColumnOfATable): string[] {
  let nameWords = columnNameWordsCache.get(column) ?? plainWordsOf(column.name ?? '');
  columnNameWordsCache.set(column, nameWords);
  return nameWords;
}
export function largestAbsoluteNumberInColumn(column: ColumnHolds): number {
  let largest =
    largestNumberInColumnCache.get(column) ??
    column.values.reduce(
      (largestSoFar, { value }) =>
        value?.kind === 'number' ? Math.max(largestSoFar, Math.abs(value.value)) : largestSoFar,
      0,
    );
  largestNumberInColumnCache.set(column, largest);
  return largest;
}
export function countUnitWordsAfter(words: readonly TypedWord[], at: number, column: ColumnHolds): number {
  let nameWords = columnNameWords(column);
  let count = 0;
  for (; ; count += 1) {
    let plain = words[at + count]?.plain ?? '';
    if (
      !(
        !NUMBER_CONDITION_WORDS.has(plain) &&
        nameWords.some((nameWord) => isWordOrItsPlural(plain, nameWord) || isWordOrItsPlural(nameWord, plain))
      )
    )
      return count;
  }
}
/** A number read from the words, and how many words it takes. */
export interface NumberRead {
  number: number;
  wordCount: number;
  isInThousands: boolean;
}
/** Both ends of a range read from the words, and how many words the range takes. */
export interface RangeRead<End> {
  ends: [End, End];
  wordCount: number;
}
export function readNumberAt(words: readonly TypedWord[], at: number, column: ColumnHolds): NumberRead | null {
  let columnName = column.name ?? '';
  let plain = words[at]?.plain ?? '';
  let numberAt = CURRENCY_SIGNS.has(plain) && (column.kind === 'currency' || columnName.includes(plain)) ? at + 1 : at;
  let [, thousandsDigits] = /[.,]$/.test(words[numberAt]?.gap ?? '') ? [] : (/^(\d{1,6})k$/.exec(words[numberAt]?.plain ?? '') ?? []);
  let digits = thousandsDigits ?? words[numberAt]?.plain ?? '';
  if (!/^-?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)$/.test(digits)) return null;
  let nameSaysK = columnNameWords(column).includes('k');
  let mayBeInThousands = nameSaysK || /(?<!\p{L})(?:m|000s?|thousands?|millions?)(?!\p{L})/iu.test(columnName);
  let hasLargeNumbers = column.areMoreValuesLeftOut || largestAbsoluteNumberInColumn(column) >= 1000;
  let number = Number(digits.replaceAll(',', ''));
  if (thousandsDigits !== undefined && (nameSaysK ? hasLargeNumbers : mayBeInThousands || !hasLargeNumbers)) return null;
  if (thousandsDigits === undefined && mayBeInThousands && Math.abs(number) >= 1000 && largestAbsoluteNumberInColumn(column) < 1000) return null;
  let scaled = number * (thousandsDigits !== undefined && !nameSaysK ? 1000 : 1);
  let isPercentSign = words[numberAt + 1]?.plain === '%';
  let isWholePercent = thousandsDigits === undefined && (isPercentSign || /^[1-9]\d+$|^[2-9]$/.test(digits));
  let hasFractionsBelowOne = () =>
    column.values.some(({ value }) => value?.kind === 'number' && value.value !== 0 && Math.abs(value.value) < 1);
  let isPercentOfWholeNumbers =
    isPercentSign && columnName.includes('%') && largestAbsoluteNumberInColumn(column) > 1 && !hasFractionsBelowOne();
  if (column.kind === 'percent' ? !isWholePercent : isPercentSign && !isPercentOfWholeNumbers) return null;
  let endAt = numberAt + (isPercentSign ? 2 : 1);
  return {
    number: column.kind === 'percent' ? scaled / 100 : scaled,
    wordCount: endAt + countUnitWordsAfter(words, endAt, column) - at,
    isInThousands: thousandsDigits !== undefined,
  };
}
export function readRangeEndsAt<End extends { wordCount: number }>(
  words: readonly TypedWord[],
  at: number,
  joiners: ReadonlySet<string>,
  readEnd: (endAt: number) => End | null,
): RangeRead<End> | null {
  let oneEnd = readEnd(at);
  if (oneEnd === null) return null;
  let afterOneEnd = at + oneEnd.wordCount;
  let isHyphenated = words[afterOneEnd]?.isAfterHyphen === true;
  if (!isHyphenated && !joiners.has(words[afterOneEnd]?.plain ?? '')) return null;
  let otherEnd = readEnd(isHyphenated ? afterOneEnd : afterOneEnd + 1);
  if (otherEnd === null) return null;
  return {
    ends: [oneEnd, otherEnd],
    wordCount: oneEnd.wordCount + (isHyphenated ? 0 : 1) + otherEnd.wordCount,
  };
}
export function readNumberCondition(words: readonly TypedWord[], at: number, column: ColumnHolds): ConditionRead | null {
  let readNumber = (numberAt: number) => readNumberAt(words, numberAt, column);
  let comparison = longestPhraseAt(NUMBER_COMPARISON_PHRASES, words, at);
  let comparedNumber = comparison === null ? null : readNumber(at + comparison.wordCount);
  if (comparison !== null && comparedNumber !== null)
    return {
      condition: numberIsCondition(comparison.meant, comparedNumber.number),
      wordCount: comparison.wordCount + comparedNumber.wordCount,
    };
  let largestSmallest = longestPhraseAt(LARGEST_SMALLEST_PHRASES, words, at);
  let count = largestSmallest === null ? null : numberMatchedInWord(words[at + largestSmallest.wordCount], /^(\d{1,4})$/);
  if (largestSmallest !== null && count !== null && count >= 1 && count <= MOST_AMONG_THE_LARGEST)
    return {
      condition: {
        kind: largestSmallest.meant,
        count,
      },
      wordCount: largestSmallest.wordCount + 1,
    };
  let betweenWordCount = words[at]?.plain === 'between' || words[at]?.plain === 'from' ? 1 : 0;
  let range = readRangeEndsAt(words, at + betweenWordCount, betweenWordCount === 1 ? RANGE_JOINERS_AND_TO : RANGE_JOINERS_TO, readNumber);
  if (range !== null) {
    let [oneEnd, otherEnd] = range.ends.map(
      ({ number }): NumberOperand => ({
        kind: 'number',
        number,
      }),
    );
    if (range.ends[0].isInThousands !== range.ends[1].isInThousands)
      return {
        condition: null,
        wordCount: betweenWordCount + range.wordCount,
      };
    if (oneEnd !== undefined && otherEnd !== undefined)
      return {
        condition: {
          kind: 'numberIsBetween',
          oneEnd,
          otherEnd,
        },
        wordCount: betweenWordCount + range.wordCount,
      };
  }
  let bareNumber = readNumber(at);
  if (bareNumber === null) return null;
  let afterNumber = at + bareNumber.wordCount;
  let { said: saidAfter, plain: plainAfter } = words[afterNumber] ?? NO_WORD_TOKEN;
  let isPlusAnd = saidAfter === '+' && plainAfter === 'and';
  if (isPlusAnd && afterNumber < words.length - 1)
    return {
      condition: null,
      wordCount: bareNumber.wordCount + 1,
    };
  let trailingComparison: PhraseFound<Comparison> | null = isPlusAnd
    ? {
        meant: 'greaterThanOrEqualTo',
        wordCount: 1,
      }
    : longestPhraseAt(NUMBER_TRAILING_COMPARISON_PHRASES, words, afterNumber);
  if (trailingComparison === null) return null;
  let wordCount = bareNumber.wordCount + trailingComparison.wordCount;
  return {
    condition: numberIsCondition(trailingComparison.meant, bareNumber.number),
    wordCount: wordCount + countUnitWordsAfter(words, at + wordCount, column),
  };
}
export const MOST_AMONG_THE_LARGEST = 1000;
export const numberMatchedInWord = (word: TypedWord | undefined, pattern: RegExp): number | null => {
  let [, digits] = pattern.exec(word?.plain ?? '') ?? [];
  return digits === undefined ? null : Number(digits);
};
export const CURRENCY_SIGNS = new Set<string>(['$', '€', '£', '¥']);
export const columnNameWordsCache = new WeakMap<ColumnOfATable, string[]>();
export const largestNumberInColumnCache = new WeakMap<ColumnHolds, number>();
export const numberIsCondition = (comparison: Comparison, number: number): CellCondition => ({
  kind: 'numberIs',
  comparison,
  operand: {
    kind: 'number',
    number,
  },
});
export const RANGE_JOINERS_TO = new Set<string>(['to']);
export const RANGE_JOINERS_AND_TO = new Set<string>(['and', 'to']);
export { NUMBER_COMPARISON_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES } from './numbers-values.ts';
