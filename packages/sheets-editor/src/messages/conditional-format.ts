import type { CellCondition, Color, Comparison, FormatOfACondition, Matches } from '@open-artifact/sheets-core';
import type { MessagePart } from '../i18n/messages.ts';
import { translateMessage, joinMessageParts } from '../i18n/messages.ts';

/** A column a rule reads or colors, as the rule list names it. */
export type RuleColumn =
  | { kind: 'named'; name: string }
  | { kind: 'lettered'; letters: string }
  | { kind: 'eachCell' }
  | { kind: 'gone' };

/** A value a condition compares cells with, as the rule list shows it. */
export type RuleOperand =
  | { kind: 'shown'; text: string }
  | { kind: 'column'; column: RuleColumn }
  | { kind: 'today' }
  | { kind: 'daysFromToday'; days: number }
  | { kind: 'daysAgo'; days: number };

/** A cell condition with the values it compares with described for the rule list. */
export type RuleCondition =
  | Exclude<CellCondition, { kind: 'numberIs' | 'numberIsBetween' | 'numberIsNotBetween' }>
  | { kind: 'numberIs'; comparison: Comparison; operand: RuleOperand }
  | { kind: 'numberIsBetween' | 'numberIsNotBetween'; oneEnd: RuleOperand; otherEnd: RuleOperand };

/** One test of a rule: the column it reads and its condition. */
export interface RuleTest {
  column: RuleColumn;
  /** The column holds dates, so comparisons read as before and after. */
  isOfDates: boolean;
  condition: RuleCondition;
}

/** What a rule does, as the rule list describes it. */
export type RuleEffect =
  | { kind: 'formatWhere'; tests: [RuleTest, ...RuleTest[]]; format: FormatOfACondition }
  | { kind: 'colorScale'; column: RuleColumn; colors: Color[] };

/** One rule, described for the rule list. */
export interface RuleDescription {
  /** The cells the rule covers, as A1 references; empty when they were deleted. */
  cells: string;
  isWholeRow: boolean;
  /** `null` when not worked out, and for a color scale. */
  matches: Matches | null;
  outOf: Matches;
  does: RuleEffect;
}

/** A row of the rule list: one rule, or several rules shown together. */
export type RuleEntry =
  | { kind: 'one'; rule: RuleDescription }
  | { kind: 'several'; first: RuleDescription; cells: string; ruleCount: number }
  | { kind: 'oneColorForEach'; column: RuleColumn; isWholeRow: boolean; cells: string; fills: Color[]; ruleCount: number };

/** The words of a rule list row. */
export interface RuleEntryWords {
  what: MessagePart[];
  cells: string;
  where: string;
}

/** A choice in a rule's condition menu. */
export type ConditionChoice = Exclude<CellCondition['kind'], 'numberIs' | 'booleanIs'> | Comparison | 'isChecked' | 'isNotChecked';

/** A choice in the menu of what a condition compares with. */
export type OperandKind = 'number' | 'date' | 'today' | 'daysFromToday' | 'daysAgo' | 'column';

export type RulePreset = 'red' | 'yellow' | 'green' | 'blue' | 'grayStruckThrough' | 'bold';

/** A stop of a color scale. */
export type ScaleStop = 'lowest' | 'middle' | 'highest';

/** Where a color scale stop sits: at the end of the values, at a number, or at a percentile. */
export type ScaleAnchorKind = 'end' | 'number' | 'percentile';

/** Why conditional formats were not worked out. */
export type RulesNotAppliedWhy = 'formulasTookTooLong' | 'tookTooLong' | 'tooManyRuns';

/** A conditional formatting change, as the last-done line tells it. */
export type ConditionalFormatDone =
  | { what: 'rulesAdded'; ruleCount: number }
  | { what: 'ruleChanged' | 'scaleColorsNothing' | 'offerDiscarded' | 'agentStopped' }
  | { what: 'movedToNumbers'; column: RuleColumn }
  | { what: 'ruleRemoved'; isSaved: boolean }
  | { what: 'ruleMoved'; place: number; ruleCount: number };

export function ruleColumnName(column: RuleColumn): string {
  switch (column.kind) {
    case 'named':
      return column.name;
    case 'lettered':
      return translateMessage(
        {
          defaultMessage: 'Column {letters}',
          id: 'YZZ74D9H7A',
        },
        {
          letters: column.letters,
        },
      );
    case 'eachCell':
      return translateMessage({
        defaultMessage: 'Cell',
        id: 'lQJ92ppcPE',
      });
    case 'gone':
      return translateMessage({
        defaultMessage: 'Deleted column',
        id: 'aMcE0WVIQ7',
      });
  }
}
export function operandWords(operand: RuleOperand): MessagePart[] {
  switch (operand.kind) {
    case 'shown':
      return [
        {
          setApart: operand.text,
        },
      ];
    case 'column':
      return ruleColumnWords(operand.column);
    case 'today':
      return [
        translateMessage({
          defaultMessage: 'today',
          id: '9SrjIclpG4',
        }),
      ];
    case 'daysFromToday':
      return [
        translateMessage(
          {
            defaultMessage: '{days, plural, one {# day from today} other {# days from today}}',
            id: 'Kgs5+IgZqG',
          },
          {
            days: operand.days,
          },
        ),
      ];
    case 'daysAgo':
      return [
        translateMessage(
          {
            defaultMessage: '{days, plural, one {# day ago} other {# days ago}}',
            id: 'uFNza1YIjw',
          },
          {
            days: operand.days,
          },
        ),
      ];
  }
}
export function daysFromTodayRange(
  kind: 'daysFromToday' | 'daysAgo',
  { oneEnd, otherEnd }: { oneEnd: RuleOperand; otherEnd: RuleOperand },
): number | null {
  let [todayEnd, daysEnd] = oneEnd.kind === 'today' ? [oneEnd, otherEnd] : [otherEnd, oneEnd];
  return todayEnd.kind === 'today' && daysEnd.kind === kind && daysEnd.days > 0 ? daysEnd.days : null;
}
export function comparisonSummary(
  test: Pick<RuleTest, 'isOfDates'> & { condition: Extract<RuleCondition, { kind: 'numberIs' }> },
  columnWords: MessagePart[],
): MessagePart[] {
  let valueWords = operandWords(test.condition.operand);
  if (test.isOfDates)
    switch (test.condition.comparison) {
      case 'lessThan':
        return translateMessage(
          {
            defaultMessage: '{column} is before {value}',
            id: 'mPfpaukUak',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
      case 'lessThanOrEqualTo':
        return translateMessage(
          {
            defaultMessage: '{column} is on or before {value}',
            id: 'NCVCRsWkE1',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
      case 'equalTo':
        return translateMessage(
          {
            defaultMessage: '{column} is on {value}',
            id: 'ejsCvhb6Eg',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
      case 'notEqualTo':
        return translateMessage(
          {
            defaultMessage: '{column} is not on {value}',
            id: '8hNUr24XTa',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
      case 'greaterThanOrEqualTo':
        return translateMessage(
          {
            defaultMessage: '{column} is on or after {value}',
            id: 'J46NVlBe+P',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
      case 'greaterThan':
        return translateMessage(
          {
            defaultMessage: '{column} is after {value}',
            id: 'W4oxlNN1/m',
          },
          {
            column: columnWords,
            value: valueWords,
          },
        );
    }
  switch (test.condition.comparison) {
    case 'lessThan':
      return translateMessage(
        {
          defaultMessage: '{column} is less than {value}',
          id: 'RtQYB+YCPd',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
    case 'lessThanOrEqualTo':
      return translateMessage(
        {
          defaultMessage: '{column} is at most {value}',
          id: 'F1B0IjaiZn',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
    case 'equalTo':
      return translateMessage(
        {
          defaultMessage: '{column} is equal to {value}',
          id: 'SryqQYD202',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
    case 'notEqualTo':
      return translateMessage(
        {
          defaultMessage: '{column} is not equal to {value}',
          id: 'Ljj5qjKc5w',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
    case 'greaterThanOrEqualTo':
      return translateMessage(
        {
          defaultMessage: '{column} is at least {value}',
          id: 'dabPJ1mzKL',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
    case 'greaterThan':
      return translateMessage(
        {
          defaultMessage: '{column} is greater than {value}',
          id: 'zxoM5UT/aR',
        },
        {
          column: columnWords,
          value: valueWords,
        },
      );
  }
}
export function ruleTestSummary(test: RuleTest): MessagePart[] {
  let columnWords = ruleColumnWords(test.column);
  let { condition } = test;
  switch (condition.kind) {
    case 'isBlank':
      return translateMessage(
        {
          defaultMessage: '{column} is blank',
          id: 'ZWavgXDTKP',
        },
        {
          column: columnWords,
        },
      );
    case 'isNotBlank':
      return translateMessage(
        {
          defaultMessage: '{column} is not blank',
          id: 'yO7j4UXC5o',
        },
        {
          column: columnWords,
        },
      );
    case 'appearsMoreThanOnce':
      return translateMessage(
        {
          defaultMessage: '{column} appears more than once',
          id: 'CV6hUTzFGQ',
        },
        {
          column: columnWords,
        },
      );
    case 'isAnError':
      return translateMessage(
        {
          defaultMessage: '{column} is an error',
          id: 'mzld9mjOLk',
        },
        {
          column: columnWords,
        },
      );
    case 'numberIs':
      return comparisonSummary(
        {
          ...test,
          condition,
        },
        columnWords,
      );
    case 'numberIsBetween': {
      let daysAhead = daysFromTodayRange('daysFromToday', condition);
      if (daysAhead !== null)
        return translateMessage(
          {
            defaultMessage:
              '{days, plural, =1 {{column} is today or tomorrow} one {{column} is in the next # day} other {{column} is in the next # days}}',
            id: 'MJ8TnIpogy',
          },
          {
            column: columnWords,
            days: daysAhead,
          },
        );
      let daysBack = daysFromTodayRange('daysAgo', condition);
      if (daysBack !== null)
        return translateMessage(
          {
            defaultMessage:
              '{days, plural, =1 {{column} is yesterday or today} one {{column} is in the last # day} other {{column} is in the last # days}}',
            id: '7evl+rdSNJ',
          },
          {
            column: columnWords,
            days: daysBack,
          },
        );
      return translateMessage(
        {
          defaultMessage: '{column} is between {from} and {to}',
          id: 'D/9LNV/AFC',
        },
        {
          column: columnWords,
          from: operandWords(condition.oneEnd),
          to: operandWords(condition.otherEnd),
        },
      );
    }
    case 'numberIsNotBetween':
      return translateMessage(
        {
          defaultMessage: '{column} is not between {from} and {to}',
          id: 'A8J/A5mj66',
        },
        {
          column: columnWords,
          from: operandWords(condition.oneEnd),
          to: operandWords(condition.otherEnd),
        },
      );
    case 'textIs':
      return translateMessage(
        {
          defaultMessage: '{column} is {text}',
          id: 'OA+/uOMAuo',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'textIsNot':
      return translateMessage(
        {
          defaultMessage: '{column} is not {text}',
          id: 'oGA7cFZ3ZE',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'textContains':
      return translateMessage(
        {
          defaultMessage: '{column} contains {text}',
          id: 'g74r4IuAOe',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'textDoesNotContain':
      return translateMessage(
        {
          defaultMessage: '{column} does not contain {text}',
          id: '+NxRW7+HyV',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'textStartsWith':
      return translateMessage(
        {
          defaultMessage: '{column} starts with {text}',
          id: 'IAWT8G7P3l',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'textEndsWith':
      return translateMessage(
        {
          defaultMessage: '{column} ends with {text}',
          id: 'srY/xkboc/',
        },
        {
          column: columnWords,
          text: [
            {
              setApart: condition.text,
            },
          ],
        },
      );
    case 'booleanIs':
      return condition.value
        ? translateMessage(
            {
              defaultMessage: '{column} is checked',
              id: 'LVww111NWK',
            },
            {
              column: columnWords,
            },
          )
        : translateMessage(
            {
              defaultMessage: '{column} is not checked',
              id: '3X1exmdkFJ',
            },
            {
              column: columnWords,
            },
          );
    case 'isAmongTheLargest':
      if (condition.count === 1)
        return translateMessage(
          {
            defaultMessage: '{column} is the largest',
            id: 'mXrokt1vXt',
          },
          {
            column: columnWords,
          },
        );
      return translateMessage(
        {
          defaultMessage: '{column} is in the top {count, number}',
          id: 'eeRSRhkw9H',
        },
        {
          column: columnWords,
          count: condition.count,
        },
      );
    case 'isAmongTheSmallest':
      if (condition.count === 1)
        return translateMessage(
          {
            defaultMessage: '{column} is the smallest',
            id: 'DFIfh6BcHx',
          },
          {
            column: columnWords,
          },
        );
      return translateMessage(
        {
          defaultMessage: '{column} is in the bottom {count, number}',
          id: '90TTC6qwzD',
        },
        {
          column: columnWords,
          count: condition.count,
        },
      );
  }
}
export function ruleSummary(rule: RuleDescription): MessagePart[] {
  if (ruleColumnIsGone(rule)) return [CONDITIONAL_FORMATTING_WORDS.columnWasDeleted()];
  if (rule.does.kind === 'colorScale')
    return translateMessage(
      {
        defaultMessage: 'Color scale on {column}',
        id: 'Pr1Bgl2Iwu',
      },
      {
        column: rule.does.column.kind === 'eachCell' ? [rule.cells] : ruleColumnWords(rule.does.column),
      },
    );
  let [firstTest, ...otherTests] = rule.does.tests;
  return otherTests.reduce(
    (summary, test) =>
      translateMessage(
        {
          defaultMessage: '{first} and {second}',
          id: 'AVS0iBrDOl',
        },
        {
          first: summary,
          second: ruleTestSummary(test),
        },
      ),
    ruleTestSummary(firstTest),
  );
}
export function ruleEntryWhatAndWhere(entry: RuleEntry): Omit<RuleEntryWords, 'cells'> {
  switch (entry.kind) {
    case 'one':
      return {
        what: ruleSummary(entry.rule),
        where: ruleWhereWords(entry.rule),
      };
    case 'several':
      return {
        what: ruleSummary(entry.first),
        where: joinWithCommas([ruleCellsWords(entry.cells), ruleCountWords(entry.ruleCount)]),
      };
    case 'oneColorForEach': {
      let columnName = ruleColumnWords(entry.column);
      return {
        what: entry.isWholeRow
          ? translateMessage(
              {
                defaultMessage: 'Color each row by {column}',
                id: 'GEp8e5qOab',
              },
              {
                column: columnName,
              },
            )
          : translateMessage(
              {
                defaultMessage: 'One color for each {column}',
                id: 'UewmN9bkxW',
              },
              {
                column: columnName,
              },
            ),
        where: joinWithCommas([ruleCellsWords(entry.cells), ruleCountWords(entry.ruleCount)]),
      };
    }
  }
}
export function wordsOfRuleEntry(entry: RuleEntry): RuleEntryWords {
  let { what, where } = ruleEntryWhatAndWhere(entry);
  switch (entry.kind) {
    case 'one':
      return {
        what: ruleListWhat(entry.rule),
        cells: ruleCellsWords(entry.rule.cells),
        where,
      };
    case 'several':
      return {
        what: entry.cells === entry.first.cells ? ruleListWhat(entry.first) : what,
        cells: ruleCellsWords(entry.cells),
        where,
      };
    case 'oneColorForEach':
      return {
        what,
        cells: ruleCellsWords(entry.cells),
        where,
      };
  }
}
export function conditionOperatorLabel(operator: ConditionChoice, isDate: boolean): string {
  switch (operator) {
    case 'isBlank':
      return translateMessage({
        defaultMessage: 'is blank',
        id: 'kVzPfFK3rN',
      });
    case 'isNotBlank':
      return translateMessage({
        defaultMessage: 'is not blank',
        id: 'X2WQP62nX2',
      });
    case 'textIs':
      return translateMessage({
        defaultMessage: 'is',
        id: 'Nis4GAlla3',
      });
    case 'textIsNot':
      return translateMessage({
        defaultMessage: 'is not',
        id: 'SwxSRj5MC0',
      });
    case 'textContains':
      return translateMessage({
        defaultMessage: 'contains',
        id: 'fo1BpC9q+G',
      });
    case 'textDoesNotContain':
      return translateMessage({
        defaultMessage: 'does not contain',
        id: '8fwRP8L7ig',
      });
    case 'textStartsWith':
      return translateMessage({
        defaultMessage: 'starts with',
        id: 'V8YST01cIq',
      });
    case 'textEndsWith':
      return translateMessage({
        defaultMessage: 'ends with',
        id: 'KeSCgjxYrs',
      });
    case 'lessThan':
      return isDate
        ? translateMessage({
            defaultMessage: 'is before',
            id: 'UgWwo77p20',
          })
        : translateMessage({
            defaultMessage: 'is less than',
            id: 'n2+V7xtb1s',
          });
    case 'lessThanOrEqualTo':
      return isDate
        ? translateMessage({
            defaultMessage: 'is on or before',
            id: 'ahJnCUOWuE',
          })
        : translateMessage({
            defaultMessage: 'is at most',
            id: 'Uku6xS/MAV',
          });
    case 'equalTo':
      return isDate
        ? translateMessage({
            defaultMessage: 'is on',
            id: 'dDv+8UO7rc',
          })
        : translateMessage({
            defaultMessage: 'is equal to',
            id: 'D07IR4IOQb',
          });
    case 'notEqualTo':
      return isDate
        ? translateMessage({
            defaultMessage: 'is not on',
            id: 'JEft0sxsq5',
          })
        : translateMessage({
            defaultMessage: 'is not equal to',
            id: 'Ghage4IZ9f',
          });
    case 'greaterThanOrEqualTo':
      return isDate
        ? translateMessage({
            defaultMessage: 'is on or after',
            id: '7bA8xNrJCq',
          })
        : translateMessage({
            defaultMessage: 'is at least',
            id: 'MOP+v2wxZL',
          });
    case 'greaterThan':
      return isDate
        ? translateMessage({
            defaultMessage: 'is after',
            id: 'bEXy+6WGjx',
          })
        : translateMessage({
            defaultMessage: 'is greater than',
            id: 'X69982hD6K',
          });
    case 'numberIsBetween':
      return translateMessage({
        defaultMessage: 'is between',
        id: 'x9Ga5U0JHN',
      });
    case 'numberIsNotBetween':
      return translateMessage({
        defaultMessage: 'is not between',
        id: 'qRHXi2YOG3',
      });
    case 'isAmongTheLargest':
      return translateMessage({
        defaultMessage: 'is in the top',
        id: 'lC0KDtJHAS',
      });
    case 'isAmongTheSmallest':
      return translateMessage({
        defaultMessage: 'is in the bottom',
        id: 'IMNTiq2Xkp',
      });
    case 'isChecked':
      return translateMessage({
        defaultMessage: 'is checked',
        id: 'OpCTuxeJtI',
      });
    case 'isNotChecked':
      return translateMessage({
        defaultMessage: 'is not checked',
        id: 'Muv0OAaPaG',
      });
    case 'appearsMoreThanOnce':
      return translateMessage({
        defaultMessage: 'appears more than once',
        id: 'jonv1rpuIM',
      });
    case 'isAnError':
      return translateMessage({
        defaultMessage: 'is an error',
        id: 'PU0dR3vU+i',
      });
  }
}
export function operandKindLabel(operandKind: OperandKind): string {
  switch (operandKind) {
    case 'number':
      return translateMessage({
        defaultMessage: 'A number',
        id: 'lnbzBcm6r2',
      });
    case 'date':
      return translateMessage({
        defaultMessage: 'A date',
        id: 'dtCpJKtNqT',
      });
    case 'today':
      return translateMessage({
        defaultMessage: 'Today',
        id: 'MdEhpvW5wl',
      });
    case 'daysFromToday':
      return translateMessage({
        defaultMessage: 'Days from today',
        id: 'k8nBDD3MGf',
      });
    case 'daysAgo':
      return translateMessage({
        defaultMessage: 'Days ago',
        id: '/4cEdNR/66',
      });
    case 'column':
      return translateMessage({
        defaultMessage: 'Another column',
        id: 'DGsCcL018x',
      });
  }
}
export function rulePresetLabel(preset: RulePreset): string {
  switch (preset) {
    case 'red':
      return translateMessage({
        defaultMessage: 'Red',
        id: 'b+9YbixxL/',
      });
    case 'yellow':
      return translateMessage({
        defaultMessage: 'Yellow',
        id: 'yo7Pl2VDrC',
      });
    case 'green':
      return translateMessage({
        defaultMessage: 'Green',
        id: 'kJmjKU3Zzj',
      });
    case 'blue':
      return translateMessage({
        defaultMessage: 'Blue',
        id: 'i3mdxOVoep',
      });
    case 'grayStruckThrough':
      return translateMessage({
        defaultMessage: 'Gray strikethrough',
        id: '05kObcarT3',
      });
    case 'bold':
      return translateMessage({
        defaultMessage: 'Bold',
        id: 'l22vbvgo10',
      });
  }
}
export function scaleStopLabel(stop: ScaleStop): string {
  switch (stop) {
    case 'lowest':
      return translateMessage({
        defaultMessage: 'Low',
        id: 'VeshfOWT1k',
      });
    case 'middle':
      return translateMessage({
        defaultMessage: 'Middle',
        id: 'XQeiMfCt7J',
      });
    case 'highest':
      return translateMessage({
        defaultMessage: 'High',
        id: 'wydiR9BMZf',
      });
  }
}
export function scaleAnchorKindLabel(anchorKind: ScaleAnchorKind, stop: ScaleStop, isDate: boolean): string {
  switch (anchorKind) {
    case 'end':
      if (isDate)
        return stop === 'lowest'
          ? translateMessage({
              defaultMessage: 'Earliest date',
              id: 's0G2Ykwq35',
            })
          : translateMessage({
              defaultMessage: 'Latest date',
              id: 'Sq5GUr0msV',
            });
      return stop === 'lowest'
        ? translateMessage({
            defaultMessage: 'Smallest value',
            id: 'O2ZCy6QNOU',
          })
        : translateMessage({
            defaultMessage: 'Largest value',
            id: '7drKYL0wrq',
          });
    case 'number':
      return isDate
        ? translateMessage({
            defaultMessage: 'Date',
            id: 'wNenWTdPuZ',
          })
        : translateMessage({
            defaultMessage: 'Number',
            id: 'efISkTJbcc',
          });
    case 'percentile':
      return translateMessage({
        defaultMessage: 'Percentile',
        id: '5l/X5Tgxm3',
      });
  }
}
export function rulesNotAppliedReason(reason: RulesNotAppliedWhy): string {
  switch (reason) {
    case 'formulasTookTooLong':
      return translateMessage({
        defaultMessage: 'Formulas took too long, so these rules aren’t applied.',
        id: '1h1Yfxhp/y',
      });
    case 'tookTooLong':
    case 'tooManyRuns':
      return translateMessage({
        defaultMessage: 'These rules took too long to apply. Remove some, or apply them to fewer cells.',
        id: 'w7khSQ9LoF',
      });
  }
}
export function ruleMatchCountWords(isWholeRow: boolean, matched: Matches, total: Matches): string {
  if (isWholeRow)
    return matched.rows === 0
      ? translateMessage({
          defaultMessage: 'Matches no rows yet',
          id: 'pHrXETOH53',
        })
      : translateMessage(
          {
            defaultMessage: '{total, plural, one {Matches {count, number} of # row} other {Matches {count, number} of {total, number} rows}}',
            id: 'rcnzUbg7BS',
          },
          {
            count: matched.rows,
            total: total.rows,
          },
        );
  return matched.cells === 0
    ? translateMessage({
        defaultMessage: 'Matches no cells yet',
        id: 'korQzgRxbd',
      })
    : translateMessage(
        {
          defaultMessage: '{total, plural, one {Matches {count, number} of # cell} other {Matches {count, number} of {total, number} cells}}',
          id: 'slGO+MLAOp',
        },
        {
          count: matched.cells,
          total: total.cells,
        },
      );
}
export function ruleReadingHint(reading: RuleDescription): string {
  let [ruleWords, cellsWords] = [joinMessageParts(ruleListWhat(reading)), ruleCellsWords(reading.cells)];
  if (reading.matches === null)
    return translateMessage(
      {
        defaultMessage: 'This reads as {rule} in {cells}. Press Enter to add it.',
        id: '3PSrsSqEOw',
      },
      {
        rule: ruleWords,
        cells: cellsWords,
      },
    );
  return reading.isWholeRow
    ? translateMessage(
        {
          defaultMessage:
            '{rows, plural, one {This reads as {rule} in {cells}. It matches # row. Press Enter to add it.} other {This reads as {rule} in {cells}. It matches # rows. Press Enter to add it.}}',
          id: 'wz/NBKrEkY',
        },
        {
          rule: ruleWords,
          cells: cellsWords,
          rows: reading.matches.rows,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{count, plural, one {This reads as {rule} in {cells}. It matches # cell. Press Enter to add it.} other {This reads as {rule} in {cells}. It matches # cells. Press Enter to add it.}}',
          id: 'VISJfz/FKT',
        },
        {
          rule: ruleWords,
          cells: cellsWords,
          count: reading.matches.cells,
        },
      );
}
export function conditionalFormatDoneWords(done: ConditionalFormatDone): string {
  switch (done.what) {
    case 'rulesAdded':
      return translateMessage(
        {
          defaultMessage: '{ruleCount, plural, one {Rule added} other {# rules added}}',
          id: 'ewRTYcXWSu',
        },
        {
          ruleCount: done.ruleCount,
        },
      );
    case 'ruleChanged':
      return translateMessage({
        defaultMessage: 'Rule changed',
        id: 'Ql3UgW5usf',
      });
    case 'movedToNumbers':
      return joinMessageParts(movedToNumbersWords(done.column));
    case 'scaleColorsNothing':
      return CONDITIONAL_FORMATTING_WORDS.noNumbersToColor();
    case 'ruleRemoved':
      return done.isSaved
        ? translateMessage({
            defaultMessage: 'Rule removed',
            id: 'PDF1OIQw+B',
          })
        : translateMessage({
            defaultMessage: 'Removing rule…',
            id: 'BmxfzqWaGy',
          });
    case 'ruleMoved':
      return translateMessage(
        {
          defaultMessage: 'Rule moved to {place, number} of {ruleCount, number}',
          id: 'ej51QwwQ5I',
        },
        {
          place: done.place,
          ruleCount: done.ruleCount,
        },
      );
    case 'offerDiscarded':
      return translateMessage({
        defaultMessage: 'Preview discarded',
        id: 'jSlshNwdyx',
      });
    case 'agentStopped':
      return translateMessage({
        defaultMessage: 'Stopped. Your request is still in the box.',
        id: 'R+6farmXlW',
      });
  }
}
export const CONDITIONAL_FORMATTING_WORDS = {
  conditionalFormatting: () =>
    translateMessage({
      defaultMessage: 'Conditional formatting',
      id: 'kQpykBw3Q6',
    }),
  askAgentForMore: () =>
    translateMessage({
      defaultMessage: 'Ask Agent for more',
      id: 'GJXVjR2M6Z',
    }),
  agentLooksForMore: () =>
    translateMessage({
      defaultMessage: 'Agent is looking for more…',
      id: 'D+J5HQX8Tk',
    }),
  moreSuggestionsFailed: () =>
    translateMessage({
      defaultMessage: 'Couldn’t get more suggestions.',
      id: 'C9LjP3iyZr',
    }),
  suggested: () =>
    translateMessage({
      defaultMessage: 'Suggested',
      id: 'UaKbFL8ZoW',
    }),
  suggestedByAgent: () =>
    translateMessage({
      defaultMessage: 'Suggested by Agent',
      id: 'P2ndMbnfUC',
    }),
  agentFoundNothingMore: () =>
    translateMessage({
      defaultMessage: 'Agent found nothing more.',
      id: '8/r2muqh7Q',
    }),
  agentCouldNotLookForMore: () =>
    translateMessage({
      defaultMessage: 'Agent couldn’t look for more.',
      id: '8sOKgkXTtU',
    }),
  rules: () =>
    translateMessage({
      defaultMessage: 'Rules',
      id: 'dT2o2Nf5Nh',
    }),
  createRule: () =>
    translateMessage({
      defaultMessage: 'Create rule',
      id: 'cr7VhKaI36',
    }),
  askAgentToMakeARule: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to make a rule',
      id: '6lwmd028OC',
    }),
  showRules: () =>
    translateMessage({
      defaultMessage: 'Show rules',
      id: 'evV2C/4Y+w',
    }),
  waysToAddARule: () =>
    translateMessage({
      defaultMessage: 'Ways to add a rule',
      id: '4bhJK9WMj2',
    }),
  writeRules: () =>
    translateMessage({
      defaultMessage: 'Write rules',
      id: 'Xuzcvb1XQn',
    }),
  writingRules: () =>
    translateMessage({
      defaultMessage: 'Writing rules…',
      id: 'r7QQ6zlCkW',
    }),
  stop: () =>
    translateMessage({
      defaultMessage: 'Stop',
      id: 'avps8xqLVM',
    }),
  rulesNotWritten: () =>
    translateMessage({
      defaultMessage: 'Couldn’t write rules for that. Try other words, or add a rule yourself.',
      id: 'M/p3pnjZMR',
    }),
  rulesAloneCantDoIt: () =>
    translateMessage({
      defaultMessage: 'Rules alone can’t do this.',
      id: 'Va18jpGe+l',
    }),
  goToChatForRules: () =>
    translateMessage({
      defaultMessage: 'Enter to go to chat',
      id: 'C1HHduN019',
    }),
  keep: () =>
    translateMessage({
      defaultMessage: 'Keep',
      id: '9g/QRXKe31',
    }),
  discard: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: 'eoUmlRcru1',
    }),
  removeRule: () =>
    translateMessage({
      defaultMessage: 'Remove rule',
      id: 'I4Cid2FHcH',
    }),
  dragToReorder: () =>
    translateMessage({
      defaultMessage: 'Drag to reorder. Higher rules win.',
      id: 'hCTL6W5Qwy',
    }),
  keysThatMoveRule: () =>
    translateMessage({
      defaultMessage: 'Use the up and down arrow keys to move it.',
      id: 'JQK2yGRt3B',
    }),
  columnWasDeleted: () =>
    translateMessage({
      defaultMessage: 'This rule’s column was deleted, so it matches nothing.',
      id: 'qSHhunjr6w',
    }),
  editRule: () =>
    translateMessage({
      defaultMessage: 'Edit rule',
      id: 'QRJwtXG1Jh',
    }),
  askAgentForEdits: () =>
    translateMessage({
      defaultMessage: 'Ask Agent for edits',
      id: 's9APHkUtz+',
    }),
  ruleAddedToMessage: () =>
    translateMessage({
      defaultMessage: 'Rule added to your message to Agent. Describe the change you want in the message box.',
      id: 'J8O60reAZr',
    }),
  ruleAttached: () =>
    translateMessage({
      defaultMessage: 'Rule',
      id: 'XLDYmgw4sP',
    }),
  backToAllRules: () =>
    translateMessage({
      defaultMessage: 'Back to all rules',
      id: 'PaKPT2tGxf',
    }),
  kindOfRule: () =>
    translateMessage({
      defaultMessage: 'Kind of rule',
      id: 'dN6qXD3I+Y',
    }),
  highlight: () =>
    translateMessage({
      defaultMessage: 'Highlight',
      id: 'Y4AufwX/y3',
    }),
  colorScale: () =>
    translateMessage({
      defaultMessage: 'Color scale',
      id: 'Y2Jnn12zvi',
    }),
  chooseACondition: () =>
    translateMessage({
      defaultMessage: 'Choose a condition',
      id: 'HJ7vUVllLs',
    }),
  addHighlightRule: () =>
    translateMessage({
      defaultMessage: 'Add highlight rule',
      id: 'L6mnsMyRKl',
    }),
  addColorScaleRule: () =>
    translateMessage({
      defaultMessage: 'Add color scale rule',
      id: 't/TR32751y',
    }),
  appliesTo: () =>
    translateMessage({
      defaultMessage: 'Applies to',
      id: 'DBff191M9f',
    }),
  cells: () =>
    translateMessage({
      defaultMessage: 'Cells',
      id: 'G7P+FLijAn',
    }),
  cellsDeleted: () =>
    translateMessage({
      defaultMessage: 'Cells deleted',
      id: 'Qex5j+Efia',
    }),
  takeSelection: () =>
    translateMessage({
      defaultMessage: 'Use selection',
      id: '9UM0R0JbmU',
    }),
  noNumbersToColor: () =>
    translateMessage({
      defaultMessage: 'A color scale needs numbers or dates. These cells have none.',
      id: 'NgydSSvX00',
    }),
  enterCells: () =>
    translateMessage({
      defaultMessage: 'Enter cells like D2:D15.',
      id: 'LrlVAK9qUa',
    }),
  conditions: () =>
    translateMessage({
      defaultMessage: 'Conditions',
      id: 'n7k004NSa2',
    }),
  when: () =>
    translateMessage({
      defaultMessage: 'When',
      id: '+8NS7Kxv54',
    }),
  column: () =>
    translateMessage({
      defaultMessage: 'Column',
      id: 'W76D+D8L1k',
    }),
  condition: () =>
    translateMessage({
      defaultMessage: 'Condition',
      id: 'QucAexI3z/',
    }),
  value: () =>
    translateMessage({
      defaultMessage: 'Value',
      id: 'KaNJRj80dh',
    }),
  kindOfValue: () =>
    translateMessage({
      defaultMessage: 'Kind of value',
      id: 's4Yb85Z325',
    }),
  thisCell: () =>
    translateMessage({
      defaultMessage: 'This cell',
      id: 'ct6qYQ+tAp',
    }),
  and: () =>
    translateMessage({
      defaultMessage: 'And',
      id: 'ogSUfeK9Q/',
    }),
  addCondition: () =>
    translateMessage({
      defaultMessage: 'Add condition',
      id: 'hD+NeK4STE',
    }),
  removeCondition: () =>
    translateMessage({
      defaultMessage: 'Remove condition',
      id: '89F6KQSZIT',
    }),
  enterANumber: () =>
    translateMessage({
      defaultMessage: 'Enter a number.',
      id: 'Tjw5NMkeJ8',
    }),
  enterText: () =>
    translateMessage({
      defaultMessage: 'Enter some text.',
      id: 'yymu81jTkp',
    }),
  format: () =>
    translateMessage({
      defaultMessage: 'Format',
      id: 'XW8Zyp83Tm',
    }),
  presets: () =>
    translateMessage({
      defaultMessage: 'Ready-made formats',
      id: 'FOv/EM0ShD',
    }),
  presetsLabel: () =>
    translateMessage({
      defaultMessage: 'Presets',
      id: 'Fyex5Uj6H4',
    }),
  style: () =>
    translateMessage({
      defaultMessage: 'Style',
      id: '24v1BIv3wO',
    }),
  sample: () =>
    translateMessage({
      defaultMessage: '123',
      id: 'QPZ0vbyGtf',
    }),
  sampleLetter: () =>
    translateMessage({
      defaultMessage: 'A',
      id: 'xnMJn5dWya',
    }),
  scale: () =>
    translateMessage({
      defaultMessage: 'Scale',
      id: 'FdERnp0hfi',
    }),
  preview: () =>
    translateMessage({
      defaultMessage: 'Preview',
      id: '/1YaNpEtI+',
    }),
  noMiddle: () =>
    translateMessage({
      defaultMessage: 'None',
      id: 'z2skHEnlaC',
    }),
};
export const joinWithDots = ([first = '', ...rest]: readonly string[]): string =>
  rest.reduce(
    (joined, next) =>
      translateMessage(
        {
          defaultMessage: '{before} · {after}',
          id: 'Mjudfvwrj2',
        },
        {
          before: joined,
          after: next,
        },
      ),
    first,
  );
export const joinWithCommas = ([first = '', ...rest]: readonly string[]): string =>
  rest.reduce(
    (joined, next) =>
      translateMessage(
        {
          defaultMessage: '{before}, {after}',
          id: '2S36vwsE4b',
        },
        {
          before: joined,
          after: next,
        },
      ),
    first,
  );
export const ruleColumnWords = (column: RuleColumn): MessagePart[] =>
  column.kind === 'named'
    ? [
        {
          setApart: column.name,
          namesColumn: true,
        },
      ]
    : [ruleColumnName(column)];
export const thisCellOfColumnWords = (column: RuleColumn): string =>
  column.kind === 'eachCell'
    ? CONDITIONAL_FORMATTING_WORDS.thisCell()
    : translateMessage(
        {
          defaultMessage: '{column} (this cell)',
          id: 'I2lPTeyImK',
        },
        {
          column: ruleColumnName(column),
        },
      );
export const ruleColumnIsGone = ({ does }: Pick<RuleDescription, 'does'>): boolean =>
  does.kind === 'formatWhere' ? does.tests.some(({ column }) => column.kind === 'gone') : does.column.kind === 'gone';
export const matchCountWords = (isWholeRow: boolean, { cells, rows }: Matches): string =>
  isWholeRow
    ? translateMessage(
        {
          defaultMessage: '{rows, plural, one {# row} other {{rows, number} rows}}',
          id: '28wJQ+OaEn',
        },
        {
          rows,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{cells, plural, one {# cell} other {{cells, number} cells}}',
          id: 'YM/IyGGWdL',
        },
        {
          cells,
        },
      );
export const ruleCountWords = (ruleCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{ruleCount, plural, one {# rule} other {# rules}}',
      id: 'TQN5y3Emob',
    },
    {
      ruleCount,
    },
  );
export const ruleListWhat = (rule: RuleDescription): MessagePart[] =>
  rule.does.kind === 'colorScale' && rule.does.column.kind === 'eachCell' ? [CONDITIONAL_FORMATTING_WORDS.colorScale()] : ruleSummary(rule);
export const ruleCellsWords = (cells: string): string => (cells === '' ? CONDITIONAL_FORMATTING_WORDS.cellsDeleted() : cells);
export const ruleWhereWords = ({ isWholeRow, cells, matches }: Pick<RuleDescription, 'isWholeRow' | 'cells' | 'matches'>): string =>
  joinWithCommas([ruleCellsWords(cells), ...(matches === null || cells === '' ? [] : [matchCountWords(isWholeRow, matches)])]);
export const movedToNumbersWords = (column: RuleColumn): MessagePart[] =>
  translateMessage(
    {
      defaultMessage: 'Moved to {column}. A color scale needs numbers or dates.',
      id: '6lK1lU+XYK',
    },
    {
      column: ruleColumnWords(column),
    },
  );
export const writtenByAgentUnsavedWords = () =>
  translateMessage({
    defaultMessage: 'Written by Agent, not saved yet',
    id: 'B2Eu8oZA/S',
  });
export const removeRuleLabel = (rule: string): string =>
  translateMessage(
    {
      defaultMessage: 'Remove {rule}',
      id: 'sUl586CSZG',
    },
    {
      rule,
    },
  );
export const reorderRuleLabel = (rule: string): string =>
  translateMessage(
    {
      defaultMessage: 'Reorder {rule}',
      id: 'a88OKxKyBN',
    },
    {
      rule,
    },
  );
export const controlWithChoiceLabel = (control: string, chosen: string | undefined): string =>
  translateMessage(
    {
      defaultMessage: '{control}, {chosen}',
      id: 'gRXwIQ2n3+',
    },
    {
      control,
      chosen,
    },
  );
export const scaleStopControlLabel = (stop: ScaleStop, control: string): string =>
  translateMessage(
    {
      defaultMessage: '{stop}, {control}',
      id: 'psRuJlgMsA',
    },
    {
      stop: scaleStopLabel(stop),
      control,
    },
  );
export const moreSuggestionsWords = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# more suggestion.} other {# more suggestions.}}',
      id: 'ufd39basPL',
    },
    {
      count,
    },
  );
export const ruleCountBadgeLabel = (ruleCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{ruleCount, plural, one {# rule} other {# rules}}',
      id: 'aAOjjG607L',
    },
    {
      ruleCount,
    },
  );
export const addRulesLabel = (ruleCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{ruleCount, plural, one {Add # rule} other {Add all # rules}}',
      id: 'Ny8cS7HZG1',
    },
    {
      ruleCount,
    },
  );
export const notARuleHint = () =>
  translateMessage({
    defaultMessage: 'This doesn’t read as a rule. Press Enter to have Agent write rules.',
    id: '6b0FytsemC',
  });
export const rulesReadyHint = (ruleCount: number): string =>
  translateMessage(
    {
      defaultMessage: '{ruleCount, plural, one {# rule ready. Press Enter to add it.} other {# rules ready. Press Enter to add all.}}',
      id: 'Ay9b9vyCt/',
    },
    {
      ruleCount,
    },
  );
