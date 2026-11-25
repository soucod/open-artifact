import type { Comparison } from '@open-artifact/sheets-core';
import { phrasesMeaning } from './tokens.ts';
import type { PhraseMeaning } from './tokens.ts';
/** How a date phrase compares a cell with a day, and whether the day counts up to its end. */
export type DateComparisonMeant = readonly [comparison: Comparison, isUntilEndOfDay: boolean];
export const MONTH_NAMES = 'january february march april may june july august september october november december'.split(' ');
export const RELATIVE_DAY_WORDS = new Map<string, number>([
  ['yesterday', -1],
  ['today', 0],
  ['tomorrow', 1],
]);
export const RELATIVE_PERIOD_WORDS = new Map<string, number>([
  ['last', -1],
  ['previous', -1],
  ['this', 0],
  ['next', 1],
]);
export const OVERDUE_PHRASES = phrasesMeaning(true, 'overdue, late, past due');
export const PAST_PHRASES = [...OVERDUE_PHRASES, ...phrasesMeaning(true, 'past, before today')];
export const DATE_COMPARISON_PHRASES: PhraseMeaning<DateComparisonMeant>[] = [
  ...phrasesMeaning(['lessThan', false], 'before, earlier than, <'),
  ...phrasesMeaning(['greaterThan', true], 'after, later than, >'),
  ...phrasesMeaning(['greaterThanOrEqualTo', false], 'since, from, starting, on or after, >=, ≥'),
  ...phrasesMeaning(['lessThanOrEqualTo', true], 'by, until, till, through, up to, on or before, <=, ≤'),
];
export const DATE_TRAILING_COMPARISON_PHRASES: PhraseMeaning<DateComparisonMeant>[] = [
  ...phrasesMeaning(['greaterThanOrEqualTo', false], 'or later, or after, and later, and after, onward, onwards'),
  ...phrasesMeaning(['lessThanOrEqualTo', true], 'or earlier, or before, and earlier, and before'),
];
export const MONTHS_IN_PERIOD = new Map<string, number>([
  ['month', 1],
  ['quarter', 3],
  ['year', 12],
]);
export const DAYS_IN_UNIT = new Map<string, number>([
  ['day', 1],
  ['days', 1],
  ['week', 7],
  ['weeks', 7],
]);
export const AGE_COMPARISON_PHRASES = [
  ...phrasesMeaning('before', 'more than, over, longer than'),
  ...phrasesMeaning('byThen', 'at least'),
  ...phrasesMeaning('since', 'less than, under, within'),
];
