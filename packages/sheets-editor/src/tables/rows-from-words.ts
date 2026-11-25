import { measureOfColumn, isPeopleColumn, valuesOfUserInColumn } from '../words/column-holds.ts';
import {
  serialToIsoDate,
  dateToSerial,
  END_OF_DAY_FRACTION,
  monthSpanRangeCondition,
  serialRangeCondition,
  weekRangeCondition,
} from '../model/date-serials.ts';
import { cleanTextForAgent, isPromptDataTooLong } from '../agent/prompt-text.ts';
import { taggedJson } from '../format/conditional/agent-prompts.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { filterOfEntries } from './filter-model.ts';
import type { Asked, CellCondition, Comparison, DecimalSignName, NumberOperand, SortDirection, ValueAskedFor } from '@open-artifact/sheets-core';
import type { LimitsOfConditionalFormats } from '../model/workbook.ts';
import type { SerialRangeCondition } from '../model/date-serials.ts';
import type { AgentPrompt } from '../format/conditional/agent-prompts.ts';
import type { ColumnHolds, RowsAskColumnTold } from '../state/initial-state.ts';
import type { RowsAsked, SortKeyOfColumn } from '../state/event-reducer.ts';
import type { FilterLine, FilterTerm } from './filter-model.ts';
/** The table the agent is told of when asked which rows: its columns by letters, and how many records it has. */
export interface TableToldOfRows {
  columns: RowsAskColumnTold[];
  records: number;
}
/** What else the agent is told of the table when asked which rows: the day, and how numbers and dates are typed. */
export interface FactsToldOfRows {
  today: string;
  decimalSign: DecimalSignName;
  isMonthFirst: boolean;
}
/** What the agent's answer of which rows is read against: the columns it was told of, who asks, the day, and the workbook's limits. */
export interface RowsAnswerContext {
  columns: RowsAskColumnTold[];
  viewer: string | null;
  today: string;
  limits: LimitsOfConditionalFormats;
}
/** A JSON object of the agent's answer, not yet checked. */
export type ObjectOfAnswer = Record<PropertyKey, unknown>;
/** An operand that is a plain number. */
export type PlainNumberOperand = Extract<NumberOperand, { kind: 'number' }>;
/** What a condition asks of a cell, as a filter asks it. */
export type ConditionAsked = Extract<Asked, { kind: 'meets' }>;
/** The span a named period of days goes by: a day, a week, or so many months; and how many spans from today's. */
export type NamedDayPeriod = readonly [unit: 'day' | 'week' | number, offset: number];
/** A kind of test of text the agent may answer with. */
export type AnswerTextTestKind = (typeof ANSWER_TEXT_TEST_KINDS)[number];
export function listedValuesEntry(key: 'options' | 'values', values: readonly string[], count: number, isMoreLeftOut: boolean) {
  let listed = values.filter((value) => value.length <= MAX_LISTED_VALUE_LENGTH).slice(0, count);
  return {
    [key]: listed,
    ...((isMoreLeftOut || listed.length < values.length) && {
      more: true,
    }),
  };
}
export function columnOfRowsPrompt({ letters, holds }: RowsAskColumnTold, listedCount: number) {
  let { name, kind, values, optionsOfDropdown, areMoreValuesLeftOut } = holds;
  let blankCount = values.find(({ value }) => value === null)?.records ?? (areMoreValuesLeftOut ? null : 0);
  let entry = {
    c: letters,
    name,
    kind,
    blank: blankCount,
  };
  if (kind === 'checkbox') return entry;
  if (measureOfColumn(holds) !== null) {
    let numbers = values.flatMap(({ value }) => (value?.kind === 'number' ? [value.value] : []));
    let shownNumber = (number: number | undefined) => (number === undefined ? null : kind === 'date' ? serialToIsoDate(number) : number);
    let largest = areMoreValuesLeftOut ? undefined : numbers.at(-1);
    return kind === 'date'
      ? {
          ...entry,
          earliest: shownNumber(numbers[0]),
          latest: shownNumber(largest),
        }
      : {
          ...entry,
          smallest: shownNumber(numbers[0]),
          largest: shownNumber(largest),
        };
  }
  if (optionsOfDropdown !== null)
    return {
      ...entry,
      kind: 'dropdown',
      ...listedValuesEntry('options', optionsOfDropdown, listedCount, false),
    };
  let texts = values
    .flatMap(
      ({ value, records }) =>
        value?.kind === 'text'
          ? [
              {
                text: value.value,
                records,
              },
            ]
          : [],
    )
    .toSorted((one, other) => other.records - one.records)
    .map(({ text }) => text);
  return {
    ...entry,
    kind: isPeopleColumn(holds) ? 'people' : 'text',
    ...listedValuesEntry('values', texts, listedCount, areMoreValuesLeftOut),
  };
}
export function rowsFromWordsPrompt(words: string, { columns, records }: TableToldOfRows, tableFacts: FactsToldOfRows): AgentPrompt | null {
  let cleanWords = cleanTextForAgent(words);
  if (cleanWords === '') return null;
  let prompt = `${ROWS_FROM_WORDS_INSTRUCTIONS}

The person typed: ${JSON.stringify(cleanWords)}`;
  for (let listedCount of LISTED_VALUE_COUNTS) {
    let shownColumns = columns.map((column) => columnOfRowsPrompt(column, listedCount));
    let request = {
      words: prompt,
      data: taggedJson('table', {
        ...tableFacts,
        records,
        columns: shownColumns,
      }),
    };
    if (!isPromptDataTooLong(request)) return request;
  }
  return null;
}
export function daySerialOfAnswerDay(isoDay: unknown): number | null {
  if (typeof isoDay !== 'string' || !ANSWER_DAY_PATTERN.test(isoDay)) return null;
  let serial = dateToSerial(isoDay);
  return Number.isFinite(serial) && serialToIsoDate(serial) === isoDay ? serial : null;
}
export function answerTestText(text: unknown, { limits }: Pick<RowsAnswerContext, 'limits'>): string | null {
  if (typeof text !== 'string' || /[\t\n\r]/.test(text)) return null;
  return text.trim() !== '' &&
    cleanTextForAgent(text) === text.trim() &&
    Array.from(text.trim()).length <= limits.longestTextOfAConditionInCharacters
    ? text.trim()
    : null;
}
export function columnValuesByText(column: ColumnHolds): Map<string, ValueAskedFor> {
  let cached = columnValuesByTextCache.get(column);
  if (cached !== undefined) return cached;
  let byText = new Map<string, ValueAskedFor>();
  for (let option of column.optionsOfDropdown ?? [])
    byText.set(foldAnswerValueText(option), {
      kind: 'text',
      value: option,
    });
  for (let { value } of column.values) if (value?.kind === 'text') byText.set(foldAnswerValueText(value.value), value);
  columnValuesByTextCache.set(column, byText);
  return byText;
}
export function answerValueInColumn(value: unknown, column: ColumnHolds, context: RowsAnswerContext): ValueAskedFor | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number')
    return Number.isFinite(value) && column.kind !== 'date' && column.kind !== 'checkbox'
      ? {
          kind: 'number',
          value,
        }
      : undefined;
  if (typeof value !== 'string') return;
  let known = columnValuesByText(column).get(foldAnswerValueText(value));
  if (known !== undefined) return known;
  let text =
    column.areMoreValuesLeftOut && column.optionsOfDropdown === null && column.kind !== 'checkbox' && measureOfColumn(column) === null
      ? answerTestText(value, context)
      : null;
  return text === null
    ? undefined
    : {
        kind: 'text',
        value: text,
      };
}
export function answerOperand(operand: unknown, isDateColumn: boolean, context: RowsAnswerContext): NumberOperand | null {
  if (!isNonNullObject(operand)) return null;
  switch (operand.kind) {
    case 'number': {
      let { number } = operand;
      return !isDateColumn && hasExactlyKeys(operand, 'kind', 'number') && typeof number === 'number' && Number.isFinite(number)
        ? numberOperandOf(number)
        : null;
    }
    case 'day':
      return isDateColumn && hasExactlyKeys(operand, 'kind', 'day') ? numberOperandOf(daySerialOfAnswerDay(operand.day)) : null;
    case 'daysFromToday': {
      let { days } = operand;
      return isDateColumn &&
        hasExactlyKeys(operand, 'kind', 'days') &&
        Number.isInteger(days) &&
        typeof days === 'number' &&
        Math.abs(days) <= 36600
        ? numberOperandOf(dateToSerial(context.today) + days)
        : null;
    }
    case 'sameRowInColumn': {
      let column = hasExactlyKeys(operand, 'kind', 'c') ? answerColumnByLetters(operand.c, context) : null;
      return column !== null && measureOfColumn(column) === (isDateColumn ? 'days' : 'numbers')
        ? {
            kind: 'sameRowInColumn',
            c: column.c,
          }
        : null;
    }
    default:
      return null;
  }
}
export function dayComparisonOfAnswer(comparison: Comparison, day: number): CellCondition {
  let dayStart: PlainNumberOperand = {
    kind: 'number',
    number: day,
  };
  let dayEnd: PlainNumberOperand = {
    kind: 'number',
    number: day + END_OF_DAY_FRACTION,
  };
  switch (comparison) {
    case 'equalTo':
      return {
        kind: 'numberIsBetween',
        oneEnd: dayStart,
        otherEnd: dayEnd,
      };
    case 'notEqualTo':
      return {
        kind: 'numberIsNotBetween',
        oneEnd: dayStart,
        otherEnd: dayEnd,
      };
    case 'greaterThan':
    case 'lessThanOrEqualTo':
      return {
        kind: 'numberIs',
        comparison,
        operand: dayEnd,
      };
    case 'greaterThanOrEqualTo':
    case 'lessThan':
      return {
        kind: 'numberIs',
        comparison,
        operand: dayStart,
      };
  }
}
export function dayPeriodOfAnswer(period: unknown, today: string): SerialRangeCondition | null {
  if (typeof period !== 'string') return null;
  if (/^[1-9]\d{3}-\d{2}$/.test(period)) return daySerialOfAnswerDay(`${period}-01`) === null ? null : monthSpanRangeCondition(`${period}-01`, 0);
  if (/^[1-9]\d{3}$/.test(period)) return daySerialOfAnswerDay(`${period}-01-01`) === null ? null : monthSpanRangeCondition(`${period}-01-01`, 0, 12);
  let namedPeriod = Object.hasOwn(NAMED_DAY_PERIODS, period) ? NAMED_DAY_PERIODS[period] : undefined;
  if (namedPeriod === undefined) return null;
  let [unit, offset] = namedPeriod;
  if (unit === 'day') return serialRangeCondition(dateToSerial(today) + offset, dateToSerial(today) + offset);
  return unit === 'week' ? weekRangeCondition(today, offset) : monthSpanRangeCondition(today, offset, unit);
}
export function askedOfAnswerTest(test: ObjectOfAnswer, column: ColumnHolds, context: RowsAnswerContext): Asked | null {
  let { kind } = test;
  let isDateColumn = column.kind === 'date';
  let isMeasured = measureOfColumn(column) !== null;
  let operandAt = (key: string) => answerOperand(test[key], isDateColumn, context);
  switch (kind) {
    case 'isOneOf':
    case 'isNoneOf': {
      let { values } = test;
      if (!hasExactlyKeys(test, 'c', 'kind', 'values') || !Array.isArray(values)) return null;
      if (values.length > MAX_ANSWER_VALUES_PER_TEST) return null;
      let valuesInColumn = values.map((answered: unknown) => answerValueInColumn(answered, column, context));
      if (valuesInColumn.includes(undefined)) return null;
      let byJson = new Map<string, ValueAskedFor | null | undefined>(valuesInColumn.map((inColumn) => [JSON.stringify(inColumn), inColumn]));
      let [firstValue, ...otherValues] = [...byJson.values()].filter((inColumn) => inColumn !== undefined);
      return firstValue === undefined
        ? null
        : {
            kind,
            values: [firstValue, ...otherValues],
          };
    }
    case 'isTheViewer':
    case 'isNotTheViewer': {
      if (!hasExactlyKeys(test, 'c', 'kind')) return null;
      let [firstValue, ...otherValues] = valuesOfUserInColumn(column, context.viewer);
      return firstValue === undefined
        ? null
        : {
            kind: kind === 'isTheViewer' ? 'isOneOf' : 'isNoneOf',
            values: [firstValue, ...otherValues],
          };
    }
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
      return hasExactlyKeys(test, 'c', 'kind')
        ? meetsConditionAsked({
            kind,
          })
        : null;
    case 'numberIs': {
      let { comparison } = test;
      let operand = operandAt('operand');
      if (!hasExactlyKeys(test, 'c', 'kind', 'comparison', 'operand') || !isMeasured) return null;
      if (!isAnswerComparison(comparison) || operand === null) return null;
      return meetsConditionAsked(
        isDateColumn && operand.kind === 'number'
          ? dayComparisonOfAnswer(comparison, operand.number)
          : {
              kind,
              comparison,
              operand,
            },
      );
    }
    case 'numberIsBetween':
    case 'numberIsNotBetween': {
      let [oneEnd, otherEnd] = [operandAt('oneEnd'), operandAt('otherEnd')];
      if (!hasExactlyKeys(test, 'c', 'kind', 'oneEnd', 'otherEnd') || !isMeasured) return null;
      if (oneEnd === null || otherEnd === null) return null;
      if (!isDateColumn)
        return meetsConditionAsked({
          kind,
          oneEnd,
          otherEnd,
        });
      if (oneEnd.kind !== 'number' || otherEnd.kind !== 'number') return null;
      let [firstDay, lastDay] = [oneEnd.number, otherEnd.number].toSorted((one, other) => one - other);
      if (firstDay === undefined || lastDay === undefined) return null;
      return meetsConditionAsked({
        kind,
        oneEnd: {
          kind: 'number',
          number: firstDay,
        },
        otherEnd: {
          kind: 'number',
          number: lastDay + END_OF_DAY_FRACTION,
        },
      });
    }
    case 'dayIsIn':
      return hasExactlyKeys(test, 'c', 'kind', 'period') && isDateColumn ? meetsConditionAsked(dayPeriodOfAnswer(test.period, context.today)) : null;
    case 'booleanIs': {
      let { value } = test;
      return hasExactlyKeys(test, 'c', 'kind', 'value') && column.kind === 'checkbox' && typeof value === 'boolean'
        ? meetsConditionAsked({
            kind,
            value,
          })
        : null;
    }
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest': {
      let { count } = test;
      if (!(hasExactlyKeys(test, 'c', 'kind', 'count') && isMeasured) || typeof count !== 'number' || !Number.isInteger(count)) return null;
      return count >= 1 && count <= context.limits.largestCountInACondition
        ? meetsConditionAsked({
            kind,
            count,
          })
        : null;
    }
    default: {
      if (!isAnswerTextTestKind(kind) || !hasExactlyKeys(test, 'c', 'kind', 'text')) return null;
      if (isMeasured || column.kind === 'checkbox') return null;
      let text = answerTestText(test.text, context);
      return text === null
        ? null
        : meetsConditionAsked({
            kind,
            text,
          });
    }
  }
}
export function answerTest(test: unknown, context: RowsAnswerContext): FilterTerm | null {
  if (!isNonNullObject(test)) return null;
  let column = answerColumnByLetters(test.c, context);
  let asked = column === null ? null : askedOfAnswerTest(test, column, context);
  return column === null || asked === null
    ? null
    : {
        c: column.c,
        asked,
      };
}
export function readAnswerItems<Item>(items: unknown, maxCount: number, readItem: (item: unknown) => Item | null): [Item, ...Item[]] | null {
  if (!Array.isArray(items) || items.length > maxCount) return null;
  let read = items.map(readItem);
  let [first, ...rest] = read.filter((item) => item !== null);
  return first === undefined || rest.length + 1 < read.length ? null : [first, ...rest];
}
export function answerFilterLine(line: unknown, context: RowsAnswerContext): FilterLine | null {
  if (!isNonNullObject(line) || !hasExactlyKeys(line, 'anyOf')) return null;
  let tests = readAnswerItems(line.anyOf, MAX_ANSWER_TESTS_PER_LINE, (test) => answerTest(test, context));
  return tests === null
    ? null
    : {
        anyOf: tests,
      };
}
export function answerSortKey(key: unknown, context: RowsAnswerContext): SortKeyOfColumn | null {
  if (!isNonNullObject(key) || !hasExactlyKeys(key, 'c', 'direction')) return null;
  let column = answerColumnByLetters(key.c, context);
  let { direction } = key;
  return column === null || !isSortDirection(direction)
    ? null
    : {
        c: column.c,
        direction,
      };
}
export function readRowsAnswer(answer: unknown, context: RowsAnswerContext): RowsAsked | null {
  if (!isNonNullObject(answer) || !hasExactlyKeys(answer, 'filter', 'sort')) return null;
  let { filter, sort } = answer;
  let filterLines =
    filter === null ? [] : readAnswerItems(filter, MAX_ANSWER_FILTER_LINES, (line) => answerFilterLine(line, context));
  let sortKeys =
    Array.isArray(sort) && sort.length === 0
      ? []
      : readAnswerItems(sort, MAX_ANSWER_SORT_KEYS, (key) => answerSortKey(key, context));
  if (filterLines === null || sortKeys === null) return null;
  if (new Set(sortKeys.map(({ c: columnId }) => columnId)).size < sortKeys.length) return null;
  if (filterLines.length === 0 && sortKeys.length === 0) return null;
  return {
    filter: filterOfEntries(filterLines),
    sortBy: sortKeys,
  };
}
export const LISTED_VALUE_COUNTS = [40, 20, 10, 5, 0];
export const MAX_LISTED_VALUE_LENGTH = 60;
export const NAMED_DAY_PERIODS: Record<string, NamedDayPeriod> = {
  today: ['day', 0],
  yesterday: ['day', -1],
  tomorrow: ['day', 1],
  thisWeek: ['week', 0],
  lastWeek: ['week', -1],
  nextWeek: ['week', 1],
  thisMonth: [1, 0],
  lastMonth: [1, -1],
  nextMonth: [1, 1],
  thisQuarter: [3, 0],
  lastQuarter: [3, -1],
  nextQuarter: [3, 1],
  thisYear: [12, 0],
  lastYear: [12, -1],
  nextYear: [12, 1],
};
export const ROWS_FROM_WORDS_INSTRUCTIONS = `You turn what a person typed into the "Which rows to show" field over a table of a spreadsheet into one JSON value. They may write in any language, in a few words or in whole sentences, with slips of the keys. The table's headers and values may be in another language than their words.

What is known of the table is in the data, as JSON on the one line between <table> and </table>. today is the day. decimalSign is what stands before the decimals of a number typed into this spreadsheet: with "comma", 1.200 is 1200 and 1,5 is 1.5. isMonthFirst is whether 3/4 is March 4 there, or April 3. records is how many records the table has. Of each column: c is its letters, name what its header says, and blank how many of its cells hold nothing, or null where that isn't known. kind is number, currency, percent, date, checkbox, dropdown, people or text. A dropdown has its options, in the order of its list. A column of people or text has values, the commonest first. more is there, and true, if it has others than those. A column of numbers has its smallest and largest, and one of dates its earliest and latest, each null where it isn't known.

Answer with this JSON alone, on one line, and nothing before or after it:
{"filter": FILTER, "sort": [KEY, ...]}
FILTER is a list of LINEs, or null where the words only sort. A record is shown if it meets every LINE.
LINE is {"anyOf": [TEST, ...]}. A record meets it if it meets one of the TESTs.
TEST has "c", a column's letters, and "kind", and what its kind takes. It is one of:
 {"c":C,"kind":"isOneOf","values":[VALUE, ...]}   VALUE is a text just as the table lists it, or as the person typed it where more is true, a number, or null for a blank cell
 {"c":C,"kind":"isNoneOf","values":[VALUE, ...]}
 {"c":C,"kind":"isTheViewer"} {"c":C,"kind":"isNotTheViewer"}   of a column of people: the person who asks, as by "my", "mine" or "me" in any language
 {"c":C,"kind":"isBlank"} {"c":C,"kind":"isNotBlank"}
 {"c":C,"kind":"numberIs","comparison":COMPARISON,"operand":OPERAND}
 {"c":C,"kind":"numberIsBetween","oneEnd":OPERAND,"otherEnd":OPERAND}   both ends count
 {"c":C,"kind":"numberIsNotBetween","oneEnd":OPERAND,"otherEnd":OPERAND}
 {"c":C,"kind":"textIs","text":T} {"c":C,"kind":"textIsNot","text":T} {"c":C,"kind":"textContains","text":T} {"c":C,"kind":"textDoesNotContain","text":T} {"c":C,"kind":"textStartsWith","text":T} {"c":C,"kind":"textEndsWith","text":T}
 {"c":C,"kind":"dayIsIn","period":PERIOD}   of a column of dates. PERIOD is ${Object.keys(NAMED_DAY_PERIODS).join(' ')}, a month as YYYY-MM, or a year as YYYY. The app works out its days
 {"c":C,"kind":"booleanIs","value":true|false}   of a checkbox
 {"c":C,"kind":"isAmongTheLargest","count":N} {"c":C,"kind":"isAmongTheSmallest","count":N}
 {"c":C,"kind":"appearsMoreThanOnce"}
COMPARISON is equalTo notEqualTo greaterThan greaterThanOrEqualTo lessThan lessThanOrEqualTo.
OPERAND is {"kind":"number","number":N}, or of a column of dates {"kind":"day","day":"YYYY-MM-DD"} or {"kind":"daysFromToday","days":N}, where today is 0 and yesterday -1, or {"kind":"sameRowInColumn","c":C}.
KEY is {"c":C,"direction":"ascending"|"descending"}, the key that counts most first. [] leaves the records as they lie. Never answer with both null and [].

How words are taken:
- A date is held against a day, daysFromToday or another column of dates, never a plain number. Overdue or past due is a deadline before today. Never work out the days of a week, a month, a quarter or a year yourself: that is dayIsIn. The last 30 days and the next two weeks are numberIsBetween with daysFromToday, today counted.
- A percent is a fraction: 50% is 0.5.
- Of a column whose values or options are listed, prefer isOneOf or isNoneOf, with each as it is listed. A word in another language, another word for the same, a plural or a slip stands for the listed value that it plainly means. Several values of one column that are all wanted go in one isOneOf.
- An ascending sort puts a dropdown's options in the order of its list.
- Ask only what the words ask. Add no test and no key that they don't call for: words that name no order get "sort": [].
- A sort with no direction said is ascending. The top 10, or the 5 cheapest, is isAmongTheLargest or isAmongTheSmallest, with no sort unless an order is asked for too. It counts among all the table's records, whatever the other LINEs leave out, so the 3 largest of the open ones cannot be said.
- Where the words ask for what is no filter or sort of this table, answer {"cannot":"notAFilterOrSort"}. Where this JSON can't say all of it, answer {"cannot":"cannotBeSaid"}. Where two readings are about as likely and would show other records, answer {"cannot":"twoReadings"}. A wrong reading is worse than none.`;
export const MAX_ANSWER_FILTER_LINES = 8;
export const MAX_ANSWER_TESTS_PER_LINE = 8;
export const MAX_ANSWER_VALUES_PER_TEST = 100;
export const MAX_ANSWER_SORT_KEYS = 4;
export const ANSWER_COMPARISONS = new Set<string>([
  'equalTo',
  'notEqualTo',
  'greaterThan',
  'greaterThanOrEqualTo',
  'lessThan',
  'lessThanOrEqualTo',
]);
export const isAnswerComparison = (value: unknown): value is Comparison => typeof value === 'string' && ANSWER_COMPARISONS.has(value);
export const hasExactlyKeys = (record: ObjectOfAnswer, ...keys: string[]): boolean =>
  Object.keys(record).length === keys.length && keys.every((key) => Object.hasOwn(record, key));
export const foldAnswerValueText = (text: string): string => text.trim().replaceAll(/\s+/g, ' ').toLowerCase();
export const ANSWER_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
export const answerColumnByLetters = (letters: unknown, { columns }: Pick<RowsAnswerContext, 'columns'>): ColumnHolds | null =>
  columns.find(({ letters: lettersOfColumn }) => lettersOfColumn === letters)?.holds ?? null;
export const columnValuesByTextCache = new WeakMap<ColumnHolds, Map<string, ValueAskedFor>>();
export const numberOperandOf = (number: number | null): PlainNumberOperand | null =>
  number === null
    ? null
    : {
        kind: 'number',
        number,
      };
export const ANSWER_TEXT_TEST_KINDS = ['textIs', 'textIsNot', 'textContains', 'textDoesNotContain', 'textStartsWith', 'textEndsWith'] as const;
export const isAnswerTextTestKind = (kind: unknown): kind is AnswerTextTestKind => ANSWER_TEXT_TEST_KINDS.some((known) => known === kind);
export const meetsConditionAsked = (condition: CellCondition | null): ConditionAsked | null =>
  condition === null
    ? null
    : {
        kind: 'meets',
        condition,
      };
export const isSortDirection = (value: unknown): value is SortDirection => value === 'ascending' || value === 'descending';
