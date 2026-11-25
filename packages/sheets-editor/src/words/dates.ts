import type { ConditionRead } from './conditions.ts';
import type { PhraseFound, TypedWord } from './tokens.ts';
import {
  dateToSerial,
  END_OF_DAY_FRACTION,
  serialRangeCondition,
  dueDatePresetCondition,
  weekRangeCondition,
  monthSpanRangeCondition,
  serialToIsoDate,
} from '../model/date-serials.ts';
import {
  RELATIVE_DAY_WORDS,
  AGE_COMPARISON_PHRASES,
  DAYS_IN_UNIT,
  PAST_PHRASES,
  RELATIVE_PERIOD_WORDS,
  MONTHS_IN_PERIOD,
  DATE_COMPARISON_PHRASES,
  DATE_TRAILING_COMPARISON_PHRASES,
  MONTH_NAMES,
  OVERDUE_PHRASES,
} from './dates-values.ts';
import { numberMatchedInWord, numberIsCondition, readRangeEndsAt, RANGE_JOINERS_AND_TO, RANGE_JOINERS_TO } from './numbers.ts';
import { DATE_CONDITION_WORDS } from './vocabulary.ts';
import { wordsMatchAt, longestPhraseAt } from './tokens.ts';
/** A day read from the words, as a day number, and how many words it takes. */
export interface DayRead {
  number: number;
  wordCount: number;
  /** The same day of the month in another year, where no year was given. */
  inYear?: (year: number) => number | null;
}
/** The first and last day numbers of a range of days. */
export type DayRange = [firstDay: number, lastDay: number];
export function dayNumberOfDate(year: number, month: number, day: number): number | null {
  let date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month && date.getUTCDate() === day && year >= 1900 && year <= 9999
    ? dateToSerial(date.toISOString().slice(0, 10))
    : null;
}
export function dayRangeIfNear(firstDay: number | null, lastDay: number | null): DayRange | null {
  if (firstDay === null || lastDay === null) return null;
  return yearOfDayNumber(firstDay) !== yearOfDayNumber(lastDay) && lastDay - firstDay > MOST_DAYS_IN_DATE_RANGE ? null : [firstDay, lastDay];
}
export function nearestYearForDay(dayRangeInYear: (year: number) => DayRange | null, today: string): DayRange | null {
  let [todayNumber, thisYear] = [dateToSerial(today), Number(today.slice(0, 4))];
  let [nearest, nearestDistance]: [DayRange | null, number] = [null, MOST_DAYS_IN_DATE_RANGE + 1];
  for (let year of [thisYear + 1, thisYear, thisYear - 1]) {
    let range = dayRangeInYear(year);
    let distance = range === null ? nearestDistance : Math.max(range[0] - todayNumber, todayNumber - range[1], 0);
    if (distance < nearestDistance) [nearest, nearestDistance] = [range, distance];
  }
  return nearest;
}
export function dayInNearestYear(month: number, day: number, wordCount: number, today: string): DayRead | null {
  let dayInYear = (year: number) => dayNumberOfDate(year, month, day);
  let [nearest] = nearestYearForDay((year) => dayRangeIfNear(dayInYear(year), dayInYear(year)), today) ?? [];
  return nearest === undefined
    ? null
    : {
        number: nearest,
        wordCount,
        inYear: dayInYear,
      };
}
export function readDayAt(words: readonly TypedWord[], at: number, today: string): DayRead | null {
  let [first, second, third, fourth, fifth] = words.slice(at, at + 5);
  let relativeDay = RELATIVE_DAY_WORDS.get(first?.plain ?? '');
  if (relativeDay !== undefined) return dayAndWordCount(dateToSerial(today) + relativeDay, 1);
  let withYear = (month: number, day: number, ...[nextWord, wordAfterComma]: (TypedWord | undefined)[]) => {
    let yearAfterComma = nextWord?.plain === ',' ? numberMatchedInWord(wordAfterComma, fourDigitYearPattern) : null;
    let year = yearAfterComma ?? numberMatchedInWord(nextWord, fourDigitYearPattern);
    if (year === null) return dayInNearestYear(month, day, 2, today);
    return dayAndWordCount(dayNumberOfDate(year, month, day), yearAfterComma === null ? 3 : 4);
  };
  let theCount = first?.plain === 'the' ? 1 : 0;
  let wordBefore = words[at - 1]?.plain ?? '';
  let dayOfMonth =
    !['to', 'in', 'and'].includes(wordBefore) && (theCount === 1 || DATE_CONDITION_WORDS.has(wordBefore))
      ? numberMatchedInWord(words[at + theCount], ordinalDayPattern)
      : null;
  if (dayOfMonth !== null && monthIndexOf(words[at + theCount + 1]?.plain ?? '') < 0 && words[at + theCount + 1]?.plain !== 'of') {
    let dayThisMonth = dayNumberOfDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, dayOfMonth);
    return dayThisMonth === null || dayThisMonth < dateToSerial(today) ? null : dayAndWordCount(dayThisMonth, theCount + 1);
  }
  let [firstMonth, secondMonth] = [monthIndexOf(first?.plain ?? ''), monthIndexOf(second?.plain ?? '')];
  let [firstDayOfMonth, secondDayOfMonth] = [numberMatchedInWord(first, dayOfMonthPattern), numberMatchedInWord(second, dayOfMonthPattern)];
  if (firstMonth >= 0 && secondDayOfMonth !== null) return withYear(firstMonth, secondDayOfMonth, third, fourth);
  if (firstDayOfMonth !== null && secondMonth >= 0) return withYear(secondMonth, firstDayOfMonth, third, fourth);
  let [firstNumber, thirdNumber] = [numberMatchedInWord(first, oneOrTwoDigitsPattern), numberMatchedInWord(third, oneOrTwoDigitsPattern)];
  if (firstNumber !== null && isSlashBetweenWords(second, third) && thirdNumber !== null) {
    let [fourDigitYear, twoDigitYear] = isSlashBetweenWords(fourth, fifth)
      ? [numberMatchedInWord(fifth, fourDigitYearPattern), numberMatchedInWord(fifth, twoDigitYearPattern)]
      : [null, null];
    if (fourDigitYear === null && twoDigitYear === null) return dayInNearestYear(firstNumber - 1, thirdNumber, 3, today);
    let nearYear = Number(today.slice(0, 4)) + 20;
    let fullYear = fourDigitYear ?? nearYear - ((((nearYear - (twoDigitYear ?? 0)) % 100) + 100) % 100);
    return dayAndWordCount(dayNumberOfDate(fullYear, firstNumber - 1, thirdNumber), 5);
  }
  let firstYear = numberMatchedInWord(first, fourDigitYearPattern);
  let [secondNumber, thirdNumberAgain] = [numberMatchedInWord(second, oneOrTwoDigitsPattern), thirdNumber];
  let isHyphenatedDate = second?.isAfterHyphen === true && third?.isAfterHyphen === true;
  if (firstYear !== null && secondNumber !== null && thirdNumberAgain !== null && isHyphenatedDate)
    return dayAndWordCount(dayNumberOfDate(firstYear, secondNumber - 1, thirdNumberAgain), 3);
  return null;
}
export function dayInYearOnSide(dayInYear: (year: number) => number | null, dayNumber: number, side: number): number | null {
  return (
    [yearOfDayNumber(dayNumber), yearOfDayNumber(dayNumber) + side]
      .map(dayInYear)
      .find((dayThatYear) => dayThatYear !== null && (dayThatYear - dayNumber) * side >= 0) ?? null
  );
}
export function dayRangeOfEnds(oneEnd: DayRead, otherEnd: DayRead, today: string): DayRange | null {
  let [oneEndInYear, otherEndInYear] = [oneEnd.inYear, otherEnd.inYear];
  if (oneEndInYear === undefined)
    return otherEndInYear === undefined
      ? [Math.min(oneEnd.number, otherEnd.number), Math.max(oneEnd.number, otherEnd.number)]
      : dayRangeIfNear(oneEnd.number, dayInYearOnSide(otherEndInYear, oneEnd.number, 1));
  if (otherEndInYear === undefined) return dayRangeIfNear(dayInYearOnSide(oneEndInYear, otherEnd.number, -1), otherEnd.number);
  return nearestYearForDay((year) => {
    let firstDay = oneEndInYear(year);
    return dayRangeIfNear(firstDay, firstDay === null ? null : dayInYearOnSide(otherEndInYear, firstDay, 1));
  }, today);
}
export function readAgoCondition(words: readonly TypedWord[], at: number, today: string): ConditionRead | null {
  let saysOlderThan = wordsMatchAt(words, at, ['older', 'than']);
  let comparison: PhraseFound<'before' | 'byThen' | 'since'> | null = saysOlderThan
    ? {
        meant: 'before',
        wordCount: 2,
      }
    : longestPhraseAt(AGE_COMPARISON_PHRASES, words, at);
  let numberAt = at + (comparison?.wordCount ?? 0);
  let days =
    (numberMatchedInWord(words[numberAt], /^(\d{1,5})$/) ?? Number.NaN) * (DAYS_IN_UNIT.get(words[numberAt + 1]?.plain ?? '') ?? Number.NaN);
  let saysAgo = words[numberAt + 2]?.plain === 'ago';
  if (!Number.isInteger(days) || days < 1 || days > 36600 || saysAgo === saysOlderThan) return null;
  let [thatDay, todayNumber] = [dateToSerial(today) - days, dateToSerial(today)];
  return {
    condition: (
      {
        before: numberIsCondition('lessThan', thatDay),
        byThen: numberIsCondition('lessThanOrEqualTo', thatDay + END_OF_DAY_FRACTION),
        since: serialRangeCondition(thatDay + 1, todayNumber),
        thatDay: serialRangeCondition(thatDay, thatDay),
      }
    )[comparison?.meant ?? 'thatDay'],
    wordCount: numberAt + (saysOlderThan ? 2 : 3) - at,
  };
}
export function readDateCondition(words: readonly TypedWord[], at: number, today: string): ConditionRead | null {
  let readDay = (dayAt: number) => readDayAt(words, dayAt, today);
  let agoCondition = readAgoCondition(words, at, today);
  if (agoCondition !== null) return agoCondition;
  let pastPhrase = longestPhraseAt(PAST_PHRASES, words, at);
  if (pastPhrase !== null)
    return {
      condition: dueDatePresetCondition('overdue', today),
      wordCount: pastPhrase.wordCount,
    };
  let periodAt = at;
  if (words[periodAt]?.plain === 'in' || words[periodAt]?.plain === 'within') periodAt += 1;
  let saysThe = words[periodAt]?.plain === 'the';
  if (saysThe) periodAt += 1;
  let periodSide = RELATIVE_PERIOD_WORDS.get(words[periodAt]?.plain ?? '');
  let [periodWord, wordAfterPeriod] = [words[periodAt + 1]?.plain ?? '', words[periodAt + 2]?.plain ?? ''];
  let monthsInPeriod = MONTHS_IN_PERIOD.get(periodWord);
  let isTheWeek = saysThe && periodSide !== undefined && periodSide !== 0;
  if (isTheWeek && monthsInPeriod !== undefined)
    return {
      condition: null,
      wordCount: periodAt + 2 - at,
    };
  let isOneWeek = isTheWeek && periodWord === 'week';
  if (periodSide !== undefined && !isOneWeek && (periodWord === 'week' || monthsInPeriod !== undefined))
    return {
      condition: monthsInPeriod === undefined ? weekRangeCondition(today, periodSide) : monthSpanRangeCondition(today, periodSide, monthsInPeriod),
      wordCount: periodAt + 2 - at,
    };
  let days = isOneWeek
    ? 7
    : (numberMatchedInWord(words[periodAt + 1], /^(\d{1,5})$/) ?? Number.NaN) * (DAYS_IN_UNIT.get(wordAfterPeriod) ?? Number.NaN);
  if (periodSide !== undefined && periodSide !== 0 && Number.isInteger(days) && days >= 1 && days <= 36600) {
    let todayNumber = dateToSerial(today);
    return {
      condition:
        periodSide > 0 ? serialRangeCondition(todayNumber, todayNumber + days - 1) : serialRangeCondition(todayNumber - days + 1, todayNumber),
      wordCount: periodAt + (isOneWeek ? 2 : 3) - at,
    };
  }
  let comparison = longestPhraseAt(DATE_COMPARISON_PHRASES, words, at);
  let comparedDay = comparison === null ? null : readDay(at + comparison.wordCount);
  let betweenWordCount = words[at]?.plain === 'between' || words[at]?.plain === 'from' ? 1 : 0;
  let range = readRangeEndsAt(words, at + betweenWordCount, betweenWordCount === 1 ? RANGE_JOINERS_AND_TO : RANGE_JOINERS_TO, readDay);
  if (range !== null) {
    let dayRange = dayRangeOfEnds(...range.ends, today);
    return {
      condition: dayRange === null ? null : serialRangeCondition(...dayRange),
      wordCount: betweenWordCount + range.wordCount,
    };
  }
  if (comparison !== null && comparedDay !== null) {
    let [dateComparison, isUntilEndOfDay] = comparison.meant;
    let comparedDayNumber =
      words[at]?.plain === 'since' && comparedDay.inYear !== undefined
        ? dayInYearOnSide(comparedDay.inYear, dateToSerial(today), -1)
        : comparedDay.number;
    let isByDayAlreadyPast = dateComparison === 'lessThanOrEqualTo' && comparedDay.inYear !== undefined && comparedDay.number < dateToSerial(today);
    return {
      condition:
        comparedDayNumber === null || isByDayAlreadyPast ? null : numberIsCondition(dateComparison, comparedDayNumber + (isUntilEndOfDay ? END_OF_DAY_FRACTION : 0)),
      wordCount: comparison.wordCount + comparedDay.wordCount,
    };
  }
  let onWordCount = words[at]?.plain === 'on' ? 1 : 0;
  let day = readDay(at + onWordCount);
  let trailingComparison = day === null ? null : longestPhraseAt(DATE_TRAILING_COMPARISON_PHRASES, words, at + onWordCount + day.wordCount);
  if (day !== null && trailingComparison !== null)
    return {
      condition: numberIsCondition(trailingComparison.meant[0], day.number + (trailingComparison.meant[1] ? END_OF_DAY_FRACTION : 0)),
      wordCount: onWordCount + day.wordCount + trailingComparison.wordCount,
    };
  if (day !== null)
    return {
      condition: serialRangeCondition(day.number, day.number),
      wordCount: onWordCount + day.wordCount,
    };
  let inWordCount = words[at]?.plain === 'in' ? 1 : 0;
  let month = monthIndexOf(words[at + inWordCount]?.plain ?? '');
  if (month < 0) return null;
  let year = numberMatchedInWord(words[at + inWordCount + 1], fourDigitYearPattern);
  let dayNumber = year === null ? (dayInNearestYear(month, 15, 1, today)?.number ?? null) : dayNumberOfDate(year, month, 15);
  let isoDay = dayNumber === null ? null : serialToIsoDate(dayNumber);
  if (isoDay === null) return null;
  return {
    condition: monthSpanRangeCondition(isoDay, 0),
    wordCount: inWordCount + (year === null ? 1 : 2),
  };
}
export const monthIndexOf = (word: string): number =>
  MONTH_NAMES.findIndex((month) => word === month || word === month.slice(0, 3) || (word === 'sept' && month === 'september'));
export const isMonthName = (word: string): boolean => monthIndexOf(word) >= 0;
export const dayOfMonthPattern = /^(\d{1,2})(?:st|nd|rd|th)?$/;
export const ordinalDayPattern = /^(\d{1,2})(?:st|nd|rd|th)$/;
export const oneOrTwoDigitsPattern = /^(\d{1,2})$/;
export const fourDigitYearPattern = /^(\d{4})$/;
export const twoDigitYearPattern = /^(\d{2})$/;
export const dayAndWordCount = (dayNumber: number | null, wordCount: number): DayRead | null =>
  dayNumber === null
    ? null
    : {
        number: dayNumber,
        wordCount,
      };
export const MOST_DAYS_IN_DATE_RANGE = 183;
export const yearOfDayNumber = (dayNumber: number): number => Number(serialToIsoDate(dayNumber)?.slice(0, 4));
export const isSlashBetweenWords = (word: TypedWord | undefined, nextWord: TypedWord | undefined): boolean =>
  word?.said === '/' && !word.isAfterBlank && nextWord?.isAfterBlank === false;
export const saysOverdueAt = (words: readonly TypedWord[], at: number): boolean => longestPhraseAt(OVERDUE_PHRASES, words, at) !== null;
export {
  PAST_PHRASES,
  OVERDUE_PHRASES,
  DATE_COMPARISON_PHRASES,
  DATE_TRAILING_COMPARISON_PHRASES,
  AGE_COMPARISON_PHRASES,
  RELATIVE_PERIOD_WORDS,
  DAYS_IN_UNIT,
  RELATIVE_DAY_WORDS,
  MONTH_NAMES,
  MONTHS_IN_PERIOD,
} from './dates-values.ts';
