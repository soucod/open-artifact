import type { CellCondition, ColumnId, ColumnOfRecords, ConditionalFormatSuggestionsAnswer, KindOfAColumn, NumberOperand, RangeCorners, RuleInIds, Test } from '@open-artifact/sheets-core';
import type { ConditionChoice, OperandKind } from '../../messages/conditional-format.ts';
import { measureOfColumn } from '../../words/column-holds.ts';
/** The records around some cells, with each of their columns counted. */
export type TableOfRecords = ConditionalFormatSuggestionsAnswer['table'];
/** The columns of a table of records, with what each holds. */
export type ColumnStats = Pick<TableOfRecords, 'columns'>;
/** The values a condition is written with, by the slot each fills. */
export interface OperandSlots {
  first?: NumberOperand;
  second?: NumberOperand;
  text?: string;
  count?: number;
}
export function operatorOfCondition(condition: CellCondition): ConditionChoice {
  if (condition.kind === 'numberIs') return condition.comparison;
  if (condition.kind === 'booleanIs') return condition.value ? 'isChecked' : 'isNotChecked';
  return condition.kind;
}
export function operatorsForColumnKind(columnKind: KindOfAColumn): ConditionChoice[] {
  switch (columnKind) {
    case 'number':
    case 'currency':
    case 'percent':
      return [...NUMBER_OPERATORS, ...RANK_OPERATORS, ...BLANK_OPERATORS, ...DUPLICATE_AND_ERROR_OPERATORS];
    case 'date':
      return [...NUMBER_OPERATORS, ...BLANK_OPERATORS, ...DUPLICATE_AND_ERROR_OPERATORS];
    case 'checkbox':
      return ['isChecked', 'isNotChecked'];
    case 'fewWords':
    case 'text':
      return [...TEXT_OPERATORS, ...BLANK_OPERATORS, ...DUPLICATE_AND_ERROR_OPERATORS];
  }
}
export function defaultFirstOperand({ kind, smallest, middle, largest }: ColumnOfRecords): NumberOperand {
  if (kind === 'date') return TODAY_OPERAND;
  return {
    kind: 'number',
    number: smallest !== null && largest !== null && smallest < 0 && largest > 0 ? 0 : (middle ?? 0),
  };
}
export function defaultSecondOperand(column: ColumnOfRecords): NumberOperand {
  if (column.kind === 'date')
    return {
      kind: 'daysFromToday',
      days: DEFAULT_DAYS_FROM_TODAY,
    };
  return {
    kind: 'number',
    number: column.largest ?? 0,
  };
}
export function operandSlotsOfCondition(condition: CellCondition): OperandSlots {
  switch (condition.kind) {
    case 'numberIs':
      return {
        first: condition.operand,
      };
    case 'numberIsBetween':
    case 'numberIsNotBetween':
      return {
        first: condition.oneEnd,
        second: condition.otherEnd,
      };
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith':
      return {
        text: condition.text,
      };
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest':
      return {
        count: condition.count,
      };
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
    case 'booleanIs':
      return {};
  }
}
export function operandsFittingColumn(
  { first, second, text, count }: OperandSlots,
  newColumn: ColumnOfRecords,
  oldColumn: ColumnOfRecords,
): OperandSlots {
  let fitsNewColumn = (operand: NumberOperand) =>
    operand.kind === 'number' && oldColumn.filled > 0
      ? newColumn.kind === oldColumn.kind
      : (newColumn.kind === 'date') === (oldColumn.kind === 'date');
  return {
    ...(first !== undefined &&
      fitsNewColumn(first) && {
        first,
      }),
    ...(second !== undefined &&
      fitsNewColumn(second) && {
        second,
      }),
    ...(text !== undefined &&
      (!isCommonestText(oldColumn, text) || isCommonestText(newColumn, text)) && {
        text,
      }),
    ...(count !== undefined && {
      count,
    }),
  };
}
export function conditionForOperator(operator: ConditionChoice, operands: OperandSlots, column: ColumnOfRecords): CellCondition {
  let firstOperand =
    operands.first !== undefined && operandFitsColumn(operands.first, column) ? operands.first : defaultFirstOperand(column);
  switch (operator) {
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
      return {
        kind: operator,
      };
    case 'isChecked':
    case 'isNotChecked':
      return {
        kind: 'booleanIs',
        value: operator === 'isChecked',
      };
    case 'lessThan':
    case 'lessThanOrEqualTo':
    case 'equalTo':
    case 'notEqualTo':
    case 'greaterThanOrEqualTo':
    case 'greaterThan':
      return {
        kind: 'numberIs',
        comparison: operator,
        operand: firstOperand,
      };
    case 'numberIsBetween':
    case 'numberIsNotBetween': {
      let secondOperand =
        operands.second !== undefined && operandFitsColumn(operands.second, column) ? operands.second : defaultSecondOperand(column);
      return {
        kind: operator,
        oneEnd: firstOperand,
        otherEnd: secondOperand,
      };
    }
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith':
      return {
        kind: operator,
        text: operands.text ?? column.commonest[0] ?? '',
      };
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest':
      return {
        kind: operator,
        count: operands.count ?? DEFAULT_RANK_COUNT,
      };
  }
}
export function conditionForNewColumn(condition: CellCondition, newColumn: ColumnOfRecords, oldColumn: ColumnOfRecords): CellCondition {
  if (newColumn.filled === 0) return condition;
  let operator = operatorOfCondition(condition);
  let operands = operandSlotsOfCondition(condition);
  let keptOperands = newColumn.c === oldColumn.c ? operands : operandsFittingColumn(operands, newColumn, oldColumn);
  return operatorsForColumnKind(newColumn.kind).includes(operator)
    ? conditionForOperator(operator, keptOperands, newColumn)
    : defaultConditionForColumn(newColumn, keptOperands);
}
export function doesConditionFitColumn(condition: CellCondition, newColumn: ColumnOfRecords, oldColumn: ColumnOfRecords): boolean {
  let operator = operatorOfCondition(condition);
  if (BLANK_OPERATORS.includes(operator) || DUPLICATE_AND_ERROR_OPERATORS.includes(operator)) return true;
  let operands = operandSlotsOfCondition(condition);
  let { first, second } = operands;
  let keptOperands = operandsFittingColumn(operands, newColumn, oldColumn);
  return (
    operatorsForColumnKind(newColumn.kind).includes(operator) &&
    (!RANK_OPERATORS.includes(operator) || newColumn.kind === oldColumn.kind) &&
    (first === undefined || (keptOperands.first !== undefined && operandFitsColumn(first, newColumn))) &&
    (second === undefined || (keptOperands.second !== undefined && operandFitsColumn(second, newColumn)))
  );
}
export function defaultConditionForColumn(column: ColumnOfRecords, operands: OperandSlots = {}): CellCondition {
  let [operator = 'isNotBlank'] = operatorsForColumnKind(column.kind);
  let condition = conditionForOperator(operator, operands, column);
  return hasEmptyTextOperand(condition)
    ? {
        kind: 'isNotBlank',
      }
    : condition;
}
export function operandChoiceOf(operand: NumberOperand, isDateColumn: boolean): OperandKind {
  if (operand.kind === 'sameRowInColumn') return 'column';
  if (operand.kind === 'number') return isDateColumn ? 'date' : 'number';
  return operand.days === 0 ? 'today' : operand.days > 0 ? 'daysFromToday' : 'daysAgo';
}
export function operandForChoice(choice: OperandKind, operand: NumberOperand, column: ColumnOfRecords, table: TableOfRecords): NumberOperand | null {
  let dayCount = operand.kind === 'daysFromToday' && operand.days !== 0 ? Math.abs(operand.days) : null;
  switch (choice) {
    case 'today':
      return TODAY_OPERAND;
    case 'daysFromToday':
      return {
        kind: 'daysFromToday',
        days: dayCount ?? DEFAULT_DAYS_FROM_TODAY,
      };
    case 'daysAgo':
      return {
        kind: 'daysFromToday',
        days: -(dayCount ?? DEFAULT_DAYS_FROM_TODAY),
      };
    case 'number':
    case 'date':
      return {
        kind: 'number',
        number: column.middle ?? 0,
      };
    case 'column': {
      let [otherColumn] = comparableOtherColumns(table, column);
      return otherColumn === undefined
        ? null
        : {
            kind: 'sameRowInColumn',
            c: otherColumn.c,
          };
    }
  }
}
export const BLANK_OPERATORS: readonly ConditionChoice[] = ['isBlank', 'isNotBlank'];
export const NUMBER_OPERATORS: readonly ConditionChoice[] = [
  'lessThan',
  'lessThanOrEqualTo',
  'equalTo',
  'notEqualTo',
  'greaterThanOrEqualTo',
  'greaterThan',
  'numberIsBetween',
  'numberIsNotBetween',
];
export const TEXT_OPERATORS: readonly ConditionChoice[] = ['textIs', 'textIsNot', 'textContains', 'textDoesNotContain', 'textStartsWith', 'textEndsWith'];
export const RANK_OPERATORS: readonly ConditionChoice[] = ['isAmongTheLargest', 'isAmongTheSmallest'];
export const DUPLICATE_AND_ERROR_OPERATORS: readonly ConditionChoice[] = ['appearsMoreThanOnce', 'isAnError'];
export const TODAY_OPERAND: Extract<NumberOperand, { kind: 'daysFromToday' }> = {
  kind: 'daysFromToday',
  days: 0,
};
export const DEFAULT_DAYS_FROM_TODAY = 7;
export const DEFAULT_RANK_COUNT = 3;
export const operandFitsColumn = (operand: NumberOperand, { kind, c }: ColumnOfRecords): boolean =>
  operand.kind === 'daysFromToday' ? kind === 'date' : operand.kind !== 'sameRowInColumn' || operand.c !== c;
export const isCommonestText = ({ commonest }: ColumnOfRecords, text: string): boolean =>
  commonest.some((common) => common.toLowerCase() === text.toLowerCase());
export const conditionWithOperator = (operator: ConditionChoice, condition: CellCondition, column: ColumnOfRecords): CellCondition =>
  conditionForOperator(operator, operandSlotsOfCondition(condition), column);
export const hasEmptyTextOperand = (operands: CellCondition): boolean => 'text' in operands && operands.text === '';
export const operandChoicesFor = (columnKind: KindOfAColumn): OperandKind[] =>
  columnKind === 'date' ? ['today', 'daysFromToday', 'daysAgo', 'date', 'column'] : ['number', 'column'];
export const comparableOtherColumns = ({ columns }: ColumnStats, column: ColumnOfRecords): ColumnOfRecords[] =>
  columns.filter(
    ({ c, kind }) =>
      c !== column.c &&
      measureOfColumn({
        kind,
      }) === (column.kind === 'date' ? 'days' : 'numbers'),
  );
export const findColumnStats = ({ columns }: ColumnStats, c: ColumnId | null): ColumnOfRecords | null =>
  columns.find((column) => column.c === c) ?? null;
export const testedColumnOf = ({ tested }: Pick<Test, 'tested'>, rangeColumn: ColumnId): ColumnId =>
  tested.kind === 'theCellItself' ? rangeColumn : tested.c;
export const firstColumnOfRule = ({ ranges: [firstRange] }: Pick<RuleInIds, 'ranges'>): ColumnId => firstRange.topLeft.c;
export const isOneColumnRange = ({ topLeft, bottomRight }: RangeCorners): boolean => topLeft.c === bottomRight.c;
export const areRangesOneSameColumn = (ranges: readonly RangeCorners[]): boolean =>
  ranges.every((range) => isOneColumnRange(range) && range.topLeft.c === ranges[0]?.topLeft.c);
export const isWholeRowRule = ({ ranges, effect }: RuleInIds): boolean =>
  effect.kind === 'formatWhere' &&
  effect.allOf.every(({ tested }) => tested.kind === 'sameRowInColumn') &&
  !ranges.every(isOneColumnRange);
