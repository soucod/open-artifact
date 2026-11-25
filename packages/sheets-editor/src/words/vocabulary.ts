import type { SortDirection } from '@open-artifact/sheets-core';
import type { PhraseMeaning } from './tokens.ts';
import { NUMBER_COMPARISON_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES } from './numbers-values.ts';
import { TEXT_TEST_PHRASES, CELL_TEST_PHRASES } from './conditions-values.ts';
import {
  PAST_PHRASES,
  DATE_COMPARISON_PHRASES,
  DATE_TRAILING_COMPARISON_PHRASES,
  AGE_COMPARISON_PHRASES,
  RELATIVE_PERIOD_WORDS,
  DAYS_IN_UNIT,
  RELATIVE_DAY_WORDS,
  MONTH_NAMES,
  MONTHS_IN_PERIOD,
} from './dates-values.ts';
/** The words of phrase lists of any meaning. */
export const wordsOfPhrases = (...phraseLists: PhraseMeaning<unknown>[][]): string[] =>
  phraseLists.flatMap((phrases) => phrases.flatMap(([words]) => words));
export const NUMBER_CONDITION_WORDS = new Set<string>([
  ...wordsOfPhrases(NUMBER_COMPARISON_PHRASES, NUMBER_TRAILING_COMPARISON_PHRASES, LARGEST_SMALLEST_PHRASES),
  ...'between from to'.split(' '),
]);
export const LARGEST_SMALLEST_WORDS = new Set<string>(wordsOfPhrases(LARGEST_SMALLEST_PHRASES));
export const TEXT_TEST_WORDS = new Set<string>(wordsOfPhrases(TEXT_TEST_PHRASES, CELL_TEST_PHRASES));
export const DATE_CONDITION_WORDS = new Set<string>([
  ...wordsOfPhrases(PAST_PHRASES, DATE_COMPARISON_PHRASES, DATE_TRAILING_COMPARISON_PHRASES, AGE_COMPARISON_PHRASES),
  ...'older ago'.split(' '),
  ...RELATIVE_PERIOD_WORDS.keys(),
  ...DAYS_IN_UNIT.keys(),
  ...RELATIVE_DAY_WORDS.keys(),
  ...MONTH_NAMES.flatMap((month) => [month, month.slice(0, 3)]),
  ...MONTHS_IN_PERIOD.keys(),
  ...'sept between from to in within the on'.split(' '),
]);
export const MOST_CHARACTERS_OF_WORDS = 200;
export const SORT_BY_PHRASES = [['ordered', 'by'], ['sorted', 'by'], ['order', 'by'], ['sort', 'by'], ['by']];
export const SORT_VERBS = new Set<string>(['sort', 'sorted', 'order', 'ordered']);
export const NO_WITHOUT_WORDS = new Set<string>(['no', 'without']);
export const NEGATING_WORDS = new Set<string>([...NO_WITHOUT_WORDS, 'not', 'hide', 'except', 'excluding', 'isnt', 'arent']);
export const EXCLUDE_VERBS = new Set<string>(['exclude', 'skip', 'ignore', 'omit']);
export const HIDING_WORDS = new Set<string>(['hide', 'except', 'excluding', 'leave', ...EXCLUDE_VERBS]);
export const WORDS_NOT_TAKEN_AS_VALUES = new Set<string>([...EXCLUDE_VERBS, 'but', 'assigned', 'set']);
export const HAVING_WORDS = new Set<string>(['with', 'has', 'have', 'having']);
export const CHECKED_RULE_WORDS = new Set<string>(['yes', 'true', 'checked', 'ticked']);
export const UNCHECKED_WORDS = new Set<string>(['no', 'false', 'unchecked', 'unticked', 'empty', 'blank']);
export const NOT_VERBS = new Set<string>(['not', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent']);
export const LINKING_VERBS = new Set<string>(['is', 'are', 'was', 'were', 'has', 'have', 'been', 'still', 'already']);
export const FIRST_PERSON_WORDS = new Set<string>(['my', 'mine', 'me']);
export const UNASSIGNED_PHRASES = [['no', 'one'], ['noone'], ['nobody'], ['unassigned'], ['not', 'assigned'], ['no', 'ones'], ['nobodys']];
export const IS_HAS_WORDS = new Set<string>(['is', 'are', 'has', 'have', 'having']);
export const POSSESSIVE_ONES_WORDS = new Set<string>(['ones', 'nobodys']);
export const SHOW_VERBS = new Set<string>(['show', 'give', 'tell']);
export const LIST_JOINERS = new Set<string>(['and', 'or', 'plus', ',']);
export const SORT_KEY_JOINERS = new Set<string>(['and', 'then', ',']);
export const EQUALS_WORDS = new Set<string>(['is', 'are', 'say', 'says', 'equals']);
export const ALL_WORDS = new Set<string>(['all', 'every', 'everything']);
export const ANYONE_WORDS = new Set<string>(['anything', 'anyone', 'everyone']);
export const BLANK_WORDS = new Set<string>(['blank', 'blanks', 'empty', 'none', 'nothing', 'missing', 'unset']);
export const FILLED_WORDS = new Set<string>(['filled', 'set', 'any', 'anything']);
export const SET_STATE_WORDS = new Set<string>(['missing', 'unset', 'set']);
export const EMPTY_WORDS = new Set<string>(['blank', 'empty', 'missing']);
export const WORDS_AFTER_COLUMN_NAME = new Set<string>([
  ...EQUALS_WORDS,
  ...NEGATING_WORDS,
  ...BLANK_WORDS,
  ...FILLED_WORDS,
  ...FIRST_PERSON_WORDS,
]);
export const ROW_NOUNS = new Set<string>('rows row items item records record entries entry'.split(' '));
export const VAGUE_NOUNS = new Set<string>(['things', 'thing', 'stuff', 'ones']);
export const RECORD_NOUNS = new Set<string>([...ROW_NOUNS, ...VAGUE_NOUNS]);
export const FILTER_FILLER_WORDS = new Set<string>(
  [...SHOW_VERBS, ...EQUALS_WORDS, ...RECORD_NOUNS].concat('only just the a an that which in of for to please column'.split(' ')),
);
export const TABLE_SUBJECT_NOUNS = new Set<string>(
  'deal deals candidate candidates applicant applicants application applications people person'
    .split(' ')
    .concat('cost costs expense expenses orders customer customers project projects bug bugs'.split(' ')),
);
export const YET_WORD = 'yet';
export const QUESTION_FILLER_WORDS = new Set<string>([
  ...'where whose who what filter filtered find list display see those'.split(' '),
  ...'still currently thats whats um uh oh ok okay'.split(' '),
  YET_WORD,
  ...TABLE_SUBJECT_NOUNS,
]);
export const TASK_NOUNS = new Set<string>(['task', 'tasks', 'issue', 'issues', 'ticket', 'tickets']);
export const SORT_DIRECTION_PHRASES: PhraseMeaning<SortDirection>[] = [
  [['ascending'], 'ascending'],
  [['asc'], 'ascending'],
  [['a', 'to', 'z'], 'ascending'],
  [['descending'], 'descending'],
  [['desc'], 'descending'],
  [['reversed'], 'descending'],
  [['z', 'to', 'a'], 'descending'],
];
export const SUPERLATIVE_DIRECTIONS = new Map<string, SortDirection>([
  ...['smallest', 'lowest', 'least', 'fewest', 'cheapest', 'shortest', 'earliest', 'oldest', 'soonest'].map(
    (word): [string, SortDirection] => [word, 'ascending'],
  ),
  ...['largest', 'biggest', 'highest', 'most', 'longest', 'latest', 'newest'].map((word): [string, SortDirection] => [word, 'descending']),
]);
export const DATE_SUPERLATIVES = new Set<string>(['earliest', 'soonest', 'latest', 'newest', 'oldest']);
export const AGE_SUPERLATIVES = new Set<string>(['newest', 'oldest']);
export const NON_COLUMN_SUPERLATIVES = new Set<string>(['cheapest', 'longest', 'shortest']);
export const ON_TOP_PHRASES = [['first'], ['on', 'top'], ['on', 'the', 'top'], ['at', 'the', 'top']];
export const RANGE_DIRECTION_PHRASES: PhraseMeaning<SortDirection>[] = [
  ...['high to low', 'highest to lowest', 'largest to smallest', 'biggest to smallest', 'newest to oldest', 'latest to earliest'].map(
    (phrase): PhraseMeaning<SortDirection> => [phrase.split(' '), 'descending'],
  ),
  ...['low to high', 'lowest to highest', 'smallest to largest', 'smallest to biggest', 'oldest to newest', 'earliest to latest'].map(
    (phrase): PhraseMeaning<SortDirection> => [phrase.split(' '), 'ascending'],
  ),
];
export const MOST_DAYS_FROM_TODAY_FOR_DATES = 92;
export const DUE_WORDS = new Set<string>(['due', 'deadline']);
export const RANK_WORDS = new Set<string>('priority prio sev severity rank ranking place position tier'.split(' '));
export const COMMAND_WORDS = new Set<string>(
  SORT_BY_PHRASES.flat().concat(
    [...SUPERLATIVE_DIRECTIONS.keys()],
    'first',
    SORT_DIRECTION_PHRASES.flatMap(([words]) => words),
  ),
);
for (let wordSet of [NEGATING_WORDS, HAVING_WORDS, FIRST_PERSON_WORDS, LIST_JOINERS, SORT_KEY_JOINERS, ALL_WORDS, FILTER_FILLER_WORDS])
  for (let word of wordSet) COMMAND_WORDS.add(word);
