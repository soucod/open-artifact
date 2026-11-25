import type { CellCondition, Comparison } from '@open-artifact/sheets-core';
import type { ColumnHolds } from '../state/initial-state.ts';
import type { PhraseFound, TypedWord } from './tokens.ts';
import { measureOfColumn } from './column-holds.ts';
import { readNumberCondition, readNumberAt, numberIsCondition } from './numbers.ts';
import { readDateCondition } from './dates.ts';
import { NO_WORD_TOKEN, longestPhraseAt, phrasesMeaning } from './tokens.ts';
import { TEXT_TEST_PHRASES, CELL_TEST_PHRASES } from './conditions-values.ts';
import { NUMBER_COMPARISON_PHRASES } from './numbers-values.ts';
/** A condition read from the words, and how many words it takes; `condition` is `null` where the words name one that cannot be used. */
export interface ConditionRead {
  condition: CellCondition | null;
  wordCount: number;
}
export function readMeasureCondition(words: readonly TypedWord[], at: number, column: ColumnHolds, today: string | null): ConditionRead | null {
  if (measureOfColumn(column) === 'numbers') return readNumberCondition(words, at, column);
  return column.kind === 'date' && today !== null ? readDateCondition(words, at, today) : null;
}
export function readTextCondition(
  words: readonly TypedWord[],
  at: number,
  endsTextAt: (textEnd: number) => boolean,
  stopsTextAt: (textEnd: number, isFirstWord: boolean) => boolean,
): ConditionRead | null {
  let { isInQuotes, gap } = words[at] ?? NO_WORD_TOKEN;
  let quotedTest: PhraseFound<'textIs'> | null = /["“”]/.test(gap)
    ? {
        meant: 'textIs',
        wordCount: 0,
      }
    : null;
  let test = isInQuotes ? quotedTest : longestPhraseAt(TEXT_TEST_PHRASES, words, at);
  if (test === null) return null;
  let textAt = at + test.wordCount;
  let startsInQuotes = words[textAt]?.isInQuotes === true;
  let textEnd = textAt;
  for (; textEnd < words.length; textEnd += 1) {
    let { isInQuotes: isEndInQuotes, gap: endGap } = words[textEnd] ?? NO_WORD_TOKEN;
    let endsAtQuote = textEnd > textAt && /["“”]/.test(endGap);
    if (startsInQuotes ? !isEndInQuotes || endsAtQuote : textEnd > textAt && endsTextAt(textEnd)) break;
    if (!startsInQuotes && (endsAtQuote || stopsTextAt(textEnd, textEnd === textAt)))
      return {
        condition: null,
        wordCount: textEnd + 1 - at,
      };
  }
  let saidText = words
    .slice(textAt, textEnd)
    .map(({ said, gap: gapBefore }, index) => (index === 0 ? said : gapBefore + said))
    .join('');
  if (!/[\p{L}\p{N}]/u.test(saidText)) return null;
  let [leadingText = ''] = /[^"“”]*$/.exec(words[textAt]?.gap ?? '') ?? [];
  let [trailingText = ''] = /^[^"“”]*/.exec(words[textEnd - 1]?.tail ?? '') ?? [];
  let text = startsInQuotes ? `${leadingText}${saidText}${trailingText}`.trim() : saidText.replace(/^['‘’](.+)['‘’]$/, '$1');
  return {
    condition:
      text.length > MOST_TEXT_TEST_CHARACTERS || /[\p{Cc}"“”]/u.test(text)
        ? null
        : {
            kind: test.meant,
            text,
          },
    wordCount: textEnd - at,
  };
}
export function readCellTestCondition(words: readonly TypedWord[], at: number): ConditionRead | null {
  let test = words[at]?.isInQuotes === true ? null : longestPhraseAt(CELL_TEST_PHRASES, words, at);
  return test === null
    ? null
    : {
        condition: {
          kind: test.meant,
        },
        wordCount: test.wordCount,
      };
}
export function readEqualsNumberCondition(words: readonly TypedWord[], at: number, column: ColumnHolds): ConditionRead | null {
  let number = measureOfColumn(column) === 'numbers' ? readNumberAt(words, at, column) : null;
  let hasLetters = words.slice(at, at + (number?.wordCount ?? 0)).some(({ plain }) => plain.includes(','));
  if (number === null || number.number < 0 || hasLetters) return null;
  return {
    condition: numberIsCondition('equalTo', number.number),
    wordCount: number.wordCount,
  };
}
export const MOST_TEXT_TEST_CHARACTERS = 100;
export const startsNumberComparisonAt = (words: readonly TypedWord[], at: number): boolean => {
  let comparison = longestPhraseAt(NUMBER_COMPARISON_PHRASES, words, at);
  return comparison !== null && /^[$€£¥]?-?[\d.]/.test(words[at + comparison.wordCount]?.plain ?? '');
};
export const testPhraseWordCountAt = (words: readonly TypedWord[], at: number): number =>
  words[at]?.isInQuotes === true
    ? 0
    : ((longestPhraseAt(TEXT_TEST_PHRASES, words, at) ?? longestPhraseAt(CELL_TEST_PHRASES, words, at))?.wordCount ?? 0);
export const COLUMN_COMPARISON_PHRASES = [
  ...phrasesMeaning('lessThan', 'before, earlier than'),
  ...phrasesMeaning('greaterThan', 'after, later than'),
  ...phrasesMeaning('greaterThanOrEqualTo', 'on or after'),
  ...phrasesMeaning('lessThanOrEqualTo', 'on or before'),
];
export const columnComparisonAt = (words: readonly TypedWord[], at: number, column: ColumnHolds): PhraseFound<Comparison> | null => {
  let measure = measureOfColumn(column);
  if (measure === null) return null;
  return longestPhraseAt(measure === 'numbers' ? NUMBER_COMPARISON_PHRASES : COLUMN_COMPARISON_PHRASES, words, at);
};
export { TEXT_TEST_PHRASES, CELL_TEST_PHRASES } from './conditions-values.ts';
