import type { CellCondition, NumberOperand } from '@open-artifact/sheets-core';
import { dateToSerial, END_OF_DAY_FRACTION, serialToIsoDate } from '../model/date-serials.ts';
import { operatorOfCondition } from '../format/conditional/conditions.ts';
import { isSameJsonValue } from '../model/same-json.ts';
import type { ConditionChoice } from '../messages/conditional-format.ts';
import type { OwnFilterConditionHeld } from '../state/initial-state.ts';
/** The kind of a field a filter condition is typed in. */
export type FilterInputKind = 'text' | 'count' | 'number' | 'day';
/** A condition as it is held in the filter list: its choice, and what is typed in its fields. */
export interface FilterChoiceHeld extends OwnFilterConditionHeld {
  choice: ConditionChoice;
}
/** How the fields of a filter condition are read: a number typed, the largest count, the longest text. */
export interface FilterInputLimits {
  numberTyped: (typed: string) => number | null;
  mostCounted: number;
  longestText: number;
}
export function inputsOfFilterChoice(choice: ConditionChoice, isDate: boolean): FilterInputKind[] {
  const numberInput = isDate ? 'day' : 'number';
  switch (choice) {
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
    case 'isChecked':
    case 'isNotChecked':
      return [];
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith':
      return ['text'];
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest':
      return ['count'];
    case 'lessThan':
    case 'lessThanOrEqualTo':
    case 'equalTo':
    case 'notEqualTo':
    case 'greaterThanOrEqualTo':
    case 'greaterThan':
      return [numberInput];
    case 'numberIsBetween':
    case 'numberIsNotBetween':
      return [numberInput, numberInput];
  }
}
export function conditionFromFilterChoice(
  { choice, first, second }: FilterChoiceHeld,
  isDate: boolean,
  { numberTyped, mostCounted, longestText }: FilterInputLimits,
): CellCondition | null {
  const numberOfInput = (typed: string) => (!isDate ? numberTyped(typed) : isIsoDateText(typed) ? dateToSerial(typed) : null);
  let endOfDay = isDate ? END_OF_DAY_FRACTION : 0;
  switch (choice) {
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
      return {
        kind: choice,
      };
    case 'isChecked':
    case 'isNotChecked':
      return {
        kind: 'booleanIs',
        value: choice === 'isChecked',
      };
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith': {
      const typed = Array.from(first.replace(CONTROL_CHARACTERS_PATTERN, '').trim()).slice(0, longestText).join('');
      return typed === ''
        ? null
        : {
            kind: choice,
            text: typed,
          };
    }
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest': {
      const typed = parseCountTyped(first, mostCounted);
      return typed === null
        ? null
        : {
            kind: choice,
            count: typed,
          };
    }
    case 'numberIsBetween':
    case 'numberIsNotBetween': {
      const [typed, otherTyped] = [numberOfInput(first), numberOfInput(second)];
      if (typed === null || otherTyped === null) return null;
      return {
        kind: choice,
        oneEnd: numberOperandOfInput(Math.min(typed, otherTyped)),
        otherEnd: numberOperandOfInput(Math.max(typed, otherTyped) + endOfDay),
      };
    }
    case 'equalTo':
    case 'notEqualTo': {
      const typed = numberOfInput(first);
      if (typed === null) return null;
      if (!isDate)
        return {
          kind: 'numberIs',
          comparison: choice,
          operand: numberOperandOfInput(typed),
        };
      return {
        kind: choice === 'equalTo' ? 'numberIsBetween' : 'numberIsNotBetween',
        oneEnd: numberOperandOfInput(typed),
        otherEnd: numberOperandOfInput(typed + endOfDay),
      };
    }
    case 'lessThan':
    case 'greaterThanOrEqualTo': {
      const typed = numberOfInput(first);
      return typed === null
        ? null
        : {
            kind: 'numberIs',
            comparison: choice,
            operand: numberOperandOfInput(typed),
          };
    }
    case 'lessThanOrEqualTo':
    case 'greaterThan': {
      const typed = numberOfInput(first);
      return typed === null
        ? null
        : {
            kind: 'numberIs',
            comparison: choice,
            operand: numberOperandOfInput(typed + endOfDay),
          };
    }
  }
}
export function isWholeDayRange(condition: CellCondition): boolean {
  if (condition.kind !== 'numberIsBetween' && condition.kind !== 'numberIsNotBetween') return false;
  const { oneEnd, otherEnd } = condition;
  return (
    oneEnd.kind === 'number' &&
    otherEnd.kind === 'number' &&
    Number.isInteger(oneEnd.number) &&
    otherEnd.number === oneEnd.number + END_OF_DAY_FRACTION
  );
}
export function filterChoiceFromCondition(
  condition: CellCondition,
  isDate: boolean,
  formatNumber: (number: number) => string,
): FilterChoiceHeld {
  const inputOfOperand = (operand: NumberOperand) => {
    if (operand.kind !== 'number') return '';
    return isDate ? (serialToIsoDate(operand.number) ?? '') : formatNumber(operand.number);
  };
  const choice = operatorOfCondition(condition);
  switch (condition.kind) {
    case 'numberIs':
      return {
        choice,
        first: inputOfOperand(condition.operand),
        second: '',
      };
    case 'numberIsBetween':
    case 'numberIsNotBetween': {
      const [first, second] = [inputOfOperand(condition.oneEnd), inputOfOperand(condition.otherEnd)];
      if (!isDate || !isWholeDayRange(condition))
        return {
          choice,
          first,
          second,
        };
      return {
        choice: condition.kind === 'numberIsBetween' ? 'equalTo' : 'notEqualTo',
        first,
        second: '',
      };
    }
    case 'textIs':
    case 'textIsNot':
    case 'textContains':
    case 'textDoesNotContain':
    case 'textStartsWith':
    case 'textEndsWith':
      return {
        choice,
        first: condition.text,
        second: '',
      };
    case 'isAmongTheLargest':
    case 'isAmongTheSmallest':
      return {
        choice,
        first: String(condition.count),
        second: '',
      };
    case 'isBlank':
    case 'isNotBlank':
    case 'appearsMoreThanOnce':
    case 'isAnError':
    case 'booleanIs':
      return {
        choice,
        first: '',
        second: '',
      };
  }
}
export function isConditionEditableAsChoice(condition: CellCondition, isDate: boolean): boolean {
  const operands = operandsOfFilterCondition(condition);
  if (operands.some(({ kind }) => kind !== 'number')) return false;
  if (!isDate || operands.length === 0) return true;
  const roundTripped = conditionFromFilterChoice(filterChoiceFromCondition(condition, true, String), true, LENIENT_FILTER_INPUT_LIMITS);
  return isSameJsonValue(roundTripped, condition);
}
export const CONTROL_CHARACTERS_PATTERN = /\p{Cc}/gu;
export const parseCountTyped = (typed: string, mostCounted: number): number | null => {
  const count = /^\d+$/.test(typed.trim()) ? Number(typed) : 0;
  return count >= 1 && count <= mostCounted ? count : null;
};
export const isIsoDateText = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text);
export const numberOperandOfInput = (number: number): NumberOperand => ({
  kind: 'number',
  number,
});
export const isFilterInputInvalid = (
  inputKind: FilterInputKind,
  typed: string,
  { numberTyped, mostCounted }: Pick<FilterInputLimits, 'numberTyped' | 'mostCounted'>,
): boolean =>
  typed.trim() !== '' &&
  ((inputKind === 'number' && numberTyped(typed) === null) || (inputKind === 'count' && parseCountTyped(typed, mostCounted) === null));
export const operandsOfFilterCondition = (condition: CellCondition): NumberOperand[] =>
  condition.kind === 'numberIs'
    ? [condition.operand]
    : condition.kind === 'numberIsBetween' || condition.kind === 'numberIsNotBetween'
      ? [condition.oneEnd, condition.otherEnd]
      : [];
export const LENIENT_FILTER_INPUT_LIMITS: FilterInputLimits = {
  numberTyped: () => null,
  mostCounted: 1 / 0,
  longestText: 1 / 0,
};
