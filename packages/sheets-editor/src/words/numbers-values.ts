import { phrasesMeaning } from './tokens.ts';
export const NUMBER_COMPARISON_PHRASES = [
  ...phrasesMeaning('greaterThan', 'over, above, more than, greater than, bigger than, larger than, higher than, >'),
  ...phrasesMeaning('lessThan', 'under, below, less than, fewer than, smaller than, lower than, <'),
  ...phrasesMeaning('greaterThanOrEqualTo', 'at least, no less than, no fewer than, >=, ≥'),
  ...phrasesMeaning('lessThanOrEqualTo', 'at most, up to, no more than, <=, ≤'),
];
export const NUMBER_TRAILING_COMPARISON_PHRASES = [
  ...phrasesMeaning('greaterThanOrEqualTo', 'or more, or over, or above, and up, +'),
  ...phrasesMeaning('lessThanOrEqualTo', 'or less, or fewer, or under, or below'),
];
export const LARGEST_SMALLEST_PHRASES = [
  ...phrasesMeaning('isAmongTheLargest', 'top, largest, biggest, highest'),
  ...phrasesMeaning('isAmongTheSmallest', 'bottom, smallest, lowest'),
];
