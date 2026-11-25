import { phrasesMeaning } from './tokens.ts';
export const TEXT_TEST_PHRASES = [
  ...phrasesMeaning('textContains', 'contains, contain, containing, includes, include, including'),
  ...phrasesMeaning(
    'textDoesNotContain',
    'does not contain, doesnt contain, do not contain, dont contain, not containing, does not include, doesnt include, not including',
  ),
  ...phrasesMeaning('textStartsWith', 'starts with, start with, starting with, begins with, begin with, beginning with'),
  ...phrasesMeaning('textEndsWith', 'ends with, end with, ending with, ends in, ending in'),
];
export const CELL_TEST_PHRASES = [
  ...phrasesMeaning('isAnError', 'an error, error, errors, in error'),
  ...phrasesMeaning(
    'appearsMoreThanOnce',
    'duplicates, duplicate, duplicated, repeated, appears more than once, appear more than once, more than once',
  ),
];
