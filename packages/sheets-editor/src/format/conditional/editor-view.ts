import type {
  CellCondition,
  Color,
  ColumnId,
  ColumnOfRecords,
  FormatOfACondition,
  Matches,
  NumberOperand,
  RuleInIds,
  SheetId,
  Stop,
  Test,
  TestedCell,
} from '@open-artifact/sheets-core';
import { columnLetters } from '../../model/a1-references.ts';
import { describeRule, areasOfRuleRanges, tableColumnNameOf } from './descriptions.ts';
import {
  areRangesOneSameColumn,
  firstColumnOfRule,
  comparableOtherColumns,
  operandChoiceOf,
  operandChoicesFor,
  operatorsForColumnKind,
  operatorOfCondition,
  isWholeRowRule,
  findColumnStats,
  testedColumnOf,
} from './conditions.ts';
import { numberFormatOfCell } from '../../model/workbook.ts';
import { withDecimalSign } from '../number-signs.ts';
import { NEW_TEST_INDEX, RULE_FORMAT_PRESETS } from './rule-edits.ts';
import { isSameJsonValue } from '../../model/same-json.ts';
import type { WorkbookReads } from '../../model/workbook.ts';
import type { ColumnStats } from './conditions.ts';
import type { ScaleAnchor } from './rule-edits.ts';
import type { RuleEditorState, RuleField } from './pane-state.ts';
import type {
  ConditionChoice,
  OperandKind,
  RuleColumn,
  RuleDescription,
  RulePreset,
  ScaleAnchorKind,
  ScaleStop,
} from '../../messages/conditional-format.ts';

/** A slot of a number condition that holds an operand. */
export type NumberOperandField = 'operand' | 'oneEnd' | 'otherEnd';

/** A box of the rule editor: what it shows, and whether it is being typed in and reads as a rule. */
export interface FieldState {
  field: RuleField;
  text: string;
  isBeingTyped: boolean;
  isReadable: boolean;
}

/** A column offered in a menu of columns; `null` is the rule's own column. */
export interface ColumnChoice<Value extends ColumnId | null = ColumnId | null> {
  value: Value;
  column: RuleColumn;
}

/** What an operand of a test shows. */
export type OperandValueView =
  | { kind: 'column'; c: ColumnId; columns: ColumnChoice<ColumnId>[] }
  | ({ kind: 'days' } & FieldState)
  | ({ kind: 'number' } & FieldState)
  | { kind: 'day'; day: string | null }
  | null;

/** An operand of a test as the editor shows it. */
export interface OperandView {
  slot: NumberOperandField;
  choice: OperandKind;
  choices: OperandKind[];
  value: OperandValueView;
}

/** The text box of a test, with words offered for it. */
export interface TextFieldView extends FieldState {
  offered: string[] | null;
}

/** A test of a rule as the editor shows it. */
export interface TestView {
  index: number;
  /** The column tested, `null` for the rule's own cells. */
  tested: ColumnId | null;
  columns: ColumnChoice[];
  isOfDates: boolean;
  choices: ConditionChoice[];
  choice: ConditionChoice | null;
  operands: OperandView[];
  text: TextFieldView | null;
  count: FieldState | null;
}

/** Where a stop of a color scale lies, as the editor shows it. */
export type StopAtView = { kind: 'day'; day: string | null } | ({ kind: 'typed' } & FieldState) | null;

/** A stop of a color scale as the editor shows it. */
export interface StopView {
  stop: ScaleStop;
  color: Color;
  choices: ScaleAnchorKind[];
  choice: ScaleAnchorKind;
  isOfDates: boolean;
  at: StopAtView;
}

/** What a rule that formats cells does, as the editor shows it. */
export interface FormatWhereView {
  kind: 'formatWhere';
  isWholeRow: boolean;
  tests: TestView[];
  canTestBeAdded: boolean;
  format: FormatOfACondition;
  preset: RulePreset | null;
}

/** What a color scale does, as the editor shows it. */
export interface ColorScaleView {
  kind: 'colorScale';
  stops: StopView[];
  hasNumbersToColor: boolean;
}

/** The rule editor as it is shown. */
export interface RuleEditorView {
  cells: FieldState;
  cellsPickedByPage: { column: RuleColumn } | null;
  does: FormatWhereView | ColorScaleView;
  matches: RuleDescription['matches'];
  outOf: RuleDescription['outOf'];
}

/** The editor's state the view is drawn from, with the test waiting for a condition. */
export interface EditorToView extends Pick<RuleEditorState, 'table' | 'typed' | 'refused' | 'cellsPickedByPage'> {
  testThatWaits: TestedCell | null;
}

export function conditionalFormatFieldValue(rule: RuleInIds, field: RuleField) {
  let { effect } = rule;
  if (field === 'cells') return rule.ranges;
  if (field === 'lowest' || field === 'middle' || field === 'highest') return effect.kind === 'colorScale' ? (effect[field]?.anchor ?? null) : null;
  let [testIndex = '', part = ''] = field.split('.');
  let condition = effect.kind === 'formatWhere' ? effect.allOf[Number(testIndex)]?.condition : undefined;
  if (condition === undefined) return null;
  if (part === 'count') return 'count' in condition ? condition.count : null;
  if (part === 'text') return 'text' in condition ? condition.text : null;
  return part === 'operand' || part === 'oneEnd' || part === 'otherEnd' ? numberConditionOperand(condition, part) : null;
}
export function numberConditionOperand(condition: CellCondition, field: NumberOperandField): NumberOperand | null {
  if (condition.kind === 'numberIs') return field === 'operand' ? condition.operand : null;
  if (condition.kind !== 'numberIsBetween' && condition.kind !== 'numberIsNotBetween') return null;
  return field === 'operand' ? null : condition[field];
}
export function columnLabelOf(
  reads: Pick<WorkbookReads, 'columnIndexOf'>,
  sheetId: SheetId,
  { c: columnId, name }: Pick<ColumnOfRecords, 'c' | 'name'>,
): RuleColumn {
  if (name !== null)
    return {
      kind: 'named',
      name,
    };
  let columnIndex = reads.columnIndexOf(sheetId, columnId);
  return columnIndex === null
    ? {
        kind: 'gone',
      }
    : {
        kind: 'lettered',
        letters: columnLetters(columnIndex),
      };
}
export function conditionalFormatEditorView(
  reads: WorkbookReads,
  sheetId: SheetId,
  rule: RuleInIds,
  { table, typed, refused = [], cellsPickedByPage, testThatWaits }: EditorToView,
  matches: Matches | null,
): RuleEditorView {
  let { effect } = rule;
  let summary = describeRule(reads, sheetId, rule, matches);
  let areas = areasOfRuleRanges(reads, sheetId, rule.ranges);
  let testsEachCell = !areRangesOneSameColumn(rule.ranges);
  let firstColumnId = firstColumnOfRule(rule);
  let topRowIndex = areas.length === 0 ? null : Math.min(...areas.map((area) => area.topRowIndex));
  let columnOption = ({ c: columnId, name }: Pick<ColumnOfRecords, 'c' | 'name'>) =>
    columnLabelOf(reads, sheetId, {
      c: columnId,
      name: (
        tableColumnNameOf(
          {
            reads,
            sheetId,
            topRowIndex,
            areas,
          },
          columnId,
        ) ?? {
          name,
        }
      ).name,
    });
  let fieldState = (field: RuleField, text: string): FieldState => {
    if (typed?.field === field)
      return {
        field,
        text: typed.text,
        isBeingTyped: true,
        isReadable: typed.rule !== null,
      };
    let refusal = refused.find((refusedTyping) => refusedTyping.field === field);
    return refusal === undefined
      ? {
          field,
          text,
          isBeingTyped: false,
          isReadable: true,
        }
      : {
          field,
          text: refusal.text,
          isBeingTyped: false,
          isReadable: false,
        };
  };
  let numberShown = (number: number, columnId: ColumnId) => {
    let cellId = {
      sheetId,
      rowId: rule.ranges[0].topLeft.r,
      columnId,
    };
    let { pattern } = numberFormatOfCell(reads, cellId);
    return (
      reads.shownWithRoomForAll(
        {
          kind: 'number',
          value: number,
        },
        pattern,
      ) ?? withDecimalSign(String(number), reads.decimalSign)
    );
  };
  let dayShown = (number: number) =>
    reads.shownWithRoomForAll(
      {
        kind: 'number',
        value: number,
      },
      ISO_DAY_PATTERN,
    );
  let operandValue = (field: RuleField, operand: NumberOperand, column: ColumnOfRecords, columnChoices: ColumnOfRecords[]): OperandValueView => {
    switch (operand.kind) {
      case 'sameRowInColumn':
        return {
          kind: 'column',
          c: operand.c,
          columns: (columnChoices.some(({ c: columnId }) => columnId === operand.c)
            ? columnChoices
            : [tableColumnSummary(table, operand.c), ...columnChoices]
          ).map(
            (choice) => ({
              value: choice.c,
              column: columnOption(choice),
            }),
          ),
        };
      case 'daysFromToday':
        return operand.days === 0
          ? null
          : {
              kind: 'days',
              ...fieldState(field, String(Math.abs(operand.days))),
            };
      case 'number': {
        if (column.kind !== 'date')
          return {
            kind: 'number',
            ...fieldState(field, numberShown(operand.number, column.c)),
          };
        return {
          kind: 'day',
          day: dayShown(operand.number),
        };
      }
    }
  };
  let operandView = (testIndex: number, slot: NumberOperandField, operand: NumberOperand, column: ColumnOfRecords): OperandView => {
    let columnChoices = table === null ? [] : comparableOtherColumns(table, column);
    let choice = operandChoiceOf(operand, column.kind === 'date');
    return {
      slot,
      choice,
      choices: withChoiceIncluded(
        operandChoicesFor(column.kind).filter((choiceOffered) => choiceOffered !== 'column' || columnChoices.length > 0),
        choice,
      ),
      value: operandValue(`${testIndex}.${slot}`, operand, column, columnChoices),
    };
  };
  let testView = (test: Test, index: number): TestView => {
    let testedColumn = testedColumnSummary(rule, table, test);
    let { condition } = test;
    let offersWords = testedColumn.kind === 'fewWords' && (condition.kind === 'textIs' || condition.kind === 'textIsNot');
    let otherColumns = (table?.columns ?? []).filter(({ c: columnId }) => testsEachCell || columnId !== firstColumnId);
    let tested = test.tested.kind === 'theCellItself' || (!testsEachCell && test.tested.c === firstColumnId) ? null : test.tested.c;
    let isTestedListed = tested === null || otherColumns.some(({ c: columnId }) => columnId === testedColumn.c);
    let ownColumnOption: ColumnChoice = {
      value: null,
      column: testsEachCell
        ? {
            kind: 'eachCell',
          }
        : columnOption(tableColumnSummary(table, firstColumnId)),
    };
    return {
      index,
      tested,
      columns: [
        ownColumnOption,
        ...(isTestedListed ? otherColumns : [testedColumn, ...otherColumns]).map(
          (column) => ({
            value: column.c,
            column: columnOption(column),
          }),
        ),
      ],
      isOfDates: testedColumn.kind === 'date',
      choices: withChoiceIncluded(operatorsForColumnKind(testedColumn.kind), operatorOfCondition(condition)),
      choice: operatorOfCondition(condition),
      operands: NUMBER_OPERAND_FIELDS.flatMap((slot) => {
        let operand = numberConditionOperand(condition, slot);
        return operand === null ? [] : [operandView(index, slot, operand, testedColumn)];
      }),
      text:
        'text' in condition
          ? {
              ...fieldState(`${index}.text`, condition.text),
              offered: offersWords ? withChoiceIncluded(testedColumn.commonest, condition.text) : null,
            }
          : null,
      count: 'count' in condition ? fieldState(`${index}.count`, String(condition.count)) : null,
    };
  };
  let waitingTestView = (tested: TestedCell): TestView => {
    let test: Test = {
      tested,
      condition: {
        kind: 'isNotBlank',
      },
    };
    return {
      ...testView(test, NEW_TEST_INDEX),
      choices: operatorsForColumnKind(testedColumnSummary(rule, table, test).kind),
      choice: null,
    };
  };
  let isOfDates = tableColumnSummary(table, firstColumnId).kind === 'date';
  let textColumnIndexes = new Set<number>(
    (table?.columns ?? []).flatMap(
      ({ c: columnId, numbers }) => (numbers === 0 ? (reads.columnIndexOf(sheetId, columnId) ?? []) : []),
    ),
  );
  let holdsNoNumbers = areas.every(
    ({ leftColumnIndex, columnCount }) =>
      columnCount <= textColumnIndexes.size &&
      Array.from(
        {
          length: columnCount,
        },
        (_, offset) => leftColumnIndex + offset,
      ).every((columnIndex) => textColumnIndexes.has(columnIndex)),
  );
  let stopView = (stop: ScaleStop, { anchor, color }: Stop<ScaleAnchor>): StopView => ({
    stop,
    color,
    choices: stop === 'middle' ? ['number', 'percentile'] : ['end', 'number', 'percentile'],
    choice: anchor.kind === 'smallestNumber' || anchor.kind === 'largestNumber' ? 'end' : anchor.kind,
    isOfDates,
    at:
      anchor.kind === 'number'
        ? isOfDates
          ? {
              kind: 'day',
              day: dayShown(anchor.number),
            }
          : {
              kind: 'typed',
              ...fieldState(stop, numberShown(anchor.number, firstColumnId)),
            }
        : anchor.kind === 'percentile'
          ? {
              kind: 'typed',
              ...fieldState(stop, String(anchor.percentile)),
            }
          : null,
  });
  return {
    cells: fieldState('cells', summary.cells),
    cellsPickedByPage:
      cellsPickedByPage !== null && effect.kind === 'colorScale' && typed?.field !== 'cells'
        ? {
            column: columnOption(tableColumnSummary(table, firstColumnId)),
          }
        : null,
    does:
      effect.kind === 'formatWhere'
        ? {
            kind: 'formatWhere',
            isWholeRow: isWholeRowRule(rule),
            tests: [...effect.allOf.map(testView), ...(testThatWaits === null ? [] : [waitingTestView(testThatWaits)])],
            canTestBeAdded: effect.allOf.length < reads.limitsOfConditionalFormats().mostTestsInAConditionalFormat,
            format: effect.format,
            preset: RULE_FORMAT_PRESETS.find(({ format }) => isSameJsonValue(format, effect.format))?.key ?? null,
          }
        : {
            kind: 'colorScale',
            stops: COLOR_SCALE_STOPS.flatMap((stop) => {
              let stopValue = effect[stop];
              return stopValue === null ? [] : [stopView(stop, stopValue)];
            }),
            hasNumbersToColor: !holdsNoNumbers,
          },
    matches: summary.matches,
    outOf: summary.outOf,
  };
}
export const UNKNOWN_COLUMN_SUMMARY: Omit<ColumnOfRecords, 'c'> = {
  name: null,
  kind: 'text',
  filled: 0,
  numbers: 0,
  blank: 0,
  commonest: [],
  smallest: null,
  middle: null,
  largest: null,
};
export const tableColumnSummary = (table: ColumnStats | null, columnId: ColumnId): ColumnOfRecords =>
  (table === null ? null : findColumnStats(table, columnId)) ?? {
    c: columnId,
    ...UNKNOWN_COLUMN_SUMMARY,
  };
export const testedColumnSummary = (rule: Pick<RuleInIds, 'ranges'>, table: ColumnStats | null, test: Pick<Test, 'tested'>): ColumnOfRecords =>
  tableColumnSummary(table, testedColumnOf(test, firstColumnOfRule(rule)));
export const ISO_DAY_PATTERN = 'yyyy-mm-dd';
export const NUMBER_OPERAND_FIELDS: readonly NumberOperandField[] = ['operand', 'oneEnd', 'otherEnd'];
export const COLOR_SCALE_STOPS: readonly ScaleStop[] = ['lowest', 'middle', 'highest'];
export const withChoiceIncluded = <Choice>(choices: Choice[], choice: Choice): Choice[] =>
  choices.includes(choice) ? choices : [choice, ...choices];
