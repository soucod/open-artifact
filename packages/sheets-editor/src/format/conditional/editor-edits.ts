import {
  areRangesOneSameColumn,
  firstColumnOfRule,
  doesConditionFitColumn,
  conditionForNewColumn,
  conditionWithOperator,
  operandForChoice,
  hasEmptyTextOperand,
  findColumnStats,
} from './conditions.ts';
import { areasOfRuleRanges } from './descriptions.ts';
import { areasOverlap } from '../../model/workbook.ts';
import { isInSpan } from '../../grid/geometry.ts';
import { tableColumnSummary, testedColumnSummary, numberConditionOperand, columnLabelOf } from './editor-view.ts';
import {
  updateRuleTest,
  orderScaleAnchors,
  isFormatNonEmpty,
  ruleWithEffectKind,
  removeRuleTest,
  RULE_FORMAT_PRESETS,
  withFormatColor,
  toggleFontStyle,
  withScalePointAnchor,
  withScalePointColor,
  withScaleMidpoint,
  testOfUnusedColumn,
  NEW_TEST_INDEX,
  withAddedTest,
  testedColumnOfRule,
} from './rule-edits.ts';
import { parseA1AreasAsSeen } from '../../model/a1-references.ts';
import { areasOfAllRanges } from '../../selection/several-ranges.ts';
import {
  conditionalFormatRuleById,
  ruleWithTestBeingAdded,
  withConditionalFormatsPane,
  queueRuleEditEffect,
  isSameRulesJson,
  tableOfRuleRange,
  conditionalFormatChangeEffect,
} from './pane-state.ts';
import { withNoEffects } from '../../state/transitions.ts';
import { askAgentForRulesFromWords } from './agent-rules.ts';
import type {
  CellCondition,
  ColumnOfRecords,
  ColumnReading,
  Edit,
  Effect,
  FormatOfACondition,
  KindOfAColumn,
  MiddleAnchor,
  NumberOperand,
  RangeCorners,
  RuleInIds,
  SheetId,
  Test,
} from '@open-artifact/sheets-core';
import type { PageState } from '../../state/initial-state.ts';
import type { PageTransition } from '../../state/transitions.ts';
import type { WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { SeveralRanges } from '../../selection/several-ranges.ts';
import type { ConditionalFormatDone } from '../../messages/conditional-format.ts';
import type { TableOfRecords } from './conditions.ts';
import type { NumberOperandField } from './editor-view.ts';
import type { ColorScaleEffect, FormatWhereRule } from './rule-edits.ts';
import type { ConditionalFormatsPane, RefusedTyping, RuleEditorState, RuleField, RulesPaneAction } from './pane-state.ts';
/** A rule, with the table of records its cells lie in. */
export interface RuleAndTable {
  rule: RuleInIds;
  table: TableOfRecords | null;
}
/** A rule being edited, with what is needed to read what is typed for it. */
export interface RuleBeingEdited extends RuleAndTable {
  reads: WorkbookReads;
  sheetId: SheetId;
}
/** Points a test at other cells when the cells of its rule move. */
export type RetargetTest = (test: Test) => Test;
/** What the page tells when a saved rule was changed by more than what was asked. */
type NoticeOfSavedRule = 'movedToNumbers' | 'scaleColorsNothing';
export function testRetargeterForRanges(reads: WorkbookReads, sheetId: SheetId, newRule: RuleInIds, edited: RuleAndTable): RetargetTest | null {
  if (areRangesOneSameColumn(newRule.ranges) || !areRangesOneSameColumn(edited.rule.ranges)) return null;
  let newAreas = areasOfRuleRanges(reads, sheetId, newRule.ranges);
  let oldAreas = areasOfRuleRanges(reads, sheetId, edited.rule.ranges);
  if (!newAreas.some((newArea) => oldAreas.some((oldArea) => areasOverlap(newArea, oldArea)))) return null;
  let filledColumns = (edited.table?.columns ?? []).filter(({ c, filled }) => {
    let columnIndex = reads.columnIndexOf(sheetId, c) ?? -1;
    return (
      filled > 0 &&
      newAreas.some(
        ({ leftColumnIndex, columnCount }) => isInSpan(columnIndex, leftColumnIndex, columnCount),
      )
    );
  });
  let testedColumn = tableColumnSummary(edited.table, firstColumnOfRule(edited.rule));
  return (test) =>
    filledColumns.every((column) => doesConditionFitColumn(test.condition, column, testedColumn))
      ? test
      : {
          ...test,
          tested: {
            kind: 'sameRowInColumn',
            c: testedColumn.c,
          },
        };
}
export function refitTestsToRanges(rule: RuleInIds, table: TableOfRecords | null, edited: RuleAndTable, retarget: RetargetTest | null): RuleInIds {
  let { effect } = rule;
  if (effect.kind !== 'formatWhere') return rule;
  let refitted = effect.allOf.reduce(
    (refittedEffect, test, testIndex) =>
      updateRuleTest(refittedEffect, testIndex, (testToRefit) => {
        if (testToRefit.tested.kind === 'theCellItself' && retarget !== null) return retarget(testToRefit);
        let condition = conditionForNewColumn(
          testToRefit.condition,
          testedColumnSummary(rule, table, testToRefit),
          testedColumnSummary(edited.rule, edited.table, testToRefit),
        );
        return 'text' in condition && 'text' in testToRefit.condition
          ? {
              ...testToRefit,
              condition: {
                ...condition,
                text: testToRefit.condition.text,
              },
            }
          : {
              ...testToRefit,
              condition,
            };
      }),
    effect,
  );
  return {
    ...rule,
    effect: refitted,
  };
}
export function rangesOfAreas(reads: WorkbookReads, sheetId: SheetId, areas: CellArea[]): RangeCorners[] | null {
  let [firstRange, ...otherRanges] = areas.flatMap((area) => {
    let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
    let topLeftCell = reads.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
    let bottomRightCell = reads.cellIdAt(sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
    return topLeftCell === null || bottomRightCell === null
      ? []
      : [
          {
            topLeft: {
              r: topLeftCell.rowId,
              c: topLeftCell.columnId,
            },
            bottomRight: {
              r: bottomRightCell.rowId,
              c: bottomRightCell.columnId,
            },
          },
        ];
  });
  let isEveryAreaInRange = otherRanges.length + 1 === areas.length;
  let isOverRangeLimit = areas.length > reads.limitsOfConditionalFormats().mostRangesInAConditionalFormat;
  return firstRange === undefined || !isEveryAreaInRange || isOverRangeLimit ? null : [firstRange, ...otherRanges];
}
export function rangesFromA1Text(reads: WorkbookReads, sheetId: SheetId, a1Text: string): RangeCorners[] | null {
  let sheet = reads.listSheets().find((listed) => listed.sheetId === sheetId);
  if (sheet === undefined) return null;
  let areas = a1Text.split(',').flatMap((part) => parseA1AreasAsSeen(part, sheet) ?? [null]);
  return areas.includes(null)
    ? null
    : rangesOfAreas(
        reads,
        sheetId,
        areas.filter((area) => area !== null),
      );
}
export function numberReadAs(reads: WorkbookReads, numberFormat: ColumnReading, text: string): number | null {
  let [reading] = reads.textsUnderAColumnReading(numberFormat, [text])?.read ?? [];
  return reading?.kind === 'fits' && reading.input.kind === 'number' ? reading.input.value : null;
}
export function numberTypedFor(reads: WorkbookReads, text: string, columnKind: KindOfAColumn): number | null {
  let decimals = {
    decimalSign: reads.decimalSign,
    decimalPlaces: 0,
  };
  let currencySymbol = /\p{Sc}/u.exec(text)?.[0];
  if (columnKind === 'percent' || text.includes('%'))
    return numberReadAs(
      reads,
      {
        kind: 'percent',
        ...decimals,
        numberAloneIs: 'percents',
      },
      text,
    );
  return currencySymbol === undefined
    ? numberReadAs(
        reads,
        {
          kind: 'number',
          ...decimals,
          groupsThousands: true,
        },
        text,
      )
    : numberReadAs(
        reads,
        {
          kind: 'currency',
          ...decimals,
          symbol: currencySymbol,
        },
        text,
      );
}
export function wholeNumberIn(text: string, least: number, most = Number.MAX_SAFE_INTEGER): number | null {
  let number = /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
  return number !== null && number >= least && number <= most ? number : null;
}
export function conditionWithTypedField(
  condition: CellCondition,
  field: string,
  typed: string,
  { kind }: Pick<ColumnOfRecords, 'kind'>,
  reads: WorkbookReads,
): CellCondition | null {
  if (field === 'text')
    return 'text' in condition && typed.trim() !== ''
      ? {
          ...condition,
          text: typed,
        }
      : null;
  if (field === 'count') {
    let number = wholeNumberIn(typed, 1);
    return 'count' in condition && number !== null
      ? {
          ...condition,
          count: Math.min(number, reads.limitsOfConditionalFormats().largestCountInACondition),
        }
      : null;
  }
  if (field !== 'operand' && field !== 'oneEnd' && field !== 'otherEnd') return null;
  let operand = numberConditionOperand(condition, field);
  if (operand?.kind === 'number') {
    let number = numberTypedFor(reads, typed, kind);
    return number === null
      ? null
      : withOperand(condition, field, {
          kind: 'number',
          number,
        });
  }
  let days = operand?.kind === 'daysFromToday' ? wholeNumberIn(typed, 1) : null;
  return operand?.kind !== 'daysFromToday' || days === null
    ? null
    : withOperand(condition, field, {
        ...operand,
        days: operand.days < 0 ? -days : days,
      });
}
export function ruleWithTypedField({ rule, table, reads, sheetId }: RuleBeingEdited, field: RuleField, typed: string): RuleInIds | null {
  let { effect } = rule;
  if (field === 'cells') {
    let end = rangesFromA1Text(reads, sheetId, typed);
    return end === null
      ? null
      : {
          ...rule,
          ranges: end,
        };
  }
  if (field === 'lowest' || field === 'middle' || field === 'highest') {
    let end = effect.kind === 'colorScale' ? effect[field] : null;
    if (effect.kind !== 'colorScale' || end === null) return null;
    let { anchor } = end;
    let number = anchor.kind === 'number' ? numberTypedFor(reads, typed, tableColumnSummary(table, firstColumnOfRule(rule)).kind) : null;
    let percentile = anchor.kind === 'percentile' ? wholeNumberIn(typed, 0, 100) : null;
    let newAnchor: MiddleAnchor | null =
      number !== null
        ? {
            kind: 'number',
            number,
          }
        : percentile !== null
          ? {
              kind: 'percentile',
              percentile,
            }
          : null;
    let scale =
      newAnchor === null
        ? null
        : orderScaleAnchors({
            ...effect,
            [field]: {
              ...end,
              anchor: newAnchor,
            },
          });
    return scale === null
      ? null
      : {
          ...rule,
          effect: scale,
        };
  }
  let [testIndexText = '', testField = ''] = field.split('.');
  let test = effect.kind === 'formatWhere' ? effect.allOf[Number(testIndexText)] : undefined;
  if (effect.kind !== 'formatWhere' || test === undefined) return null;
  let condition = conditionWithTypedField(test.condition, testField, typed, testedColumnSummary(rule, table, test), reads);
  return condition === null
    ? null
    : {
        ...rule,
        effect: updateRuleTest(
          effect,
          Number(testIndexText),
          (testBefore) => ({
            ...testBefore,
            condition,
          }),
        ),
      };
}
export function ruleAfterEditorAction(
  { rule, table, reads, sheetId }: RuleBeingEdited,
  selection: SeveralRanges,
  action: RulesPaneAction,
): RuleInIds | null {
  let { effect } = rule;
  let ruleWhere: FormatWhereRule | null =
    effect.kind === 'formatWhere'
      ? {
          ...rule,
          effect,
        }
      : null;
  let withEffect = (newEffect: Effect | null) =>
    newEffect === null
      ? null
      : {
          ...rule,
          effect: newEffect,
        };
  let changeTest = (testIndex: number, change: (test: Test, column: ColumnOfRecords) => CellCondition | null) => {
    let test = ruleWhere?.effect.allOf[testIndex];
    if (ruleWhere === null || test === undefined) return null;
    let condition = change(test, testedColumnSummary(rule, table, test));
    return condition === null
      ? null
      : withEffect(
          updateRuleTest(
            ruleWhere.effect,
            testIndex,
            (testBefore) => ({
              ...testBefore,
              condition,
            }),
          ),
        );
  };
  let withFormat = (format: FormatOfACondition) =>
    ruleWhere === null || !isFormatNonEmpty(format)
      ? null
      : withEffect({
          ...ruleWhere.effect,
          format,
        });
  let changeScale = (change: (scale: ColorScaleEffect) => ColorScaleEffect) => (effect.kind === 'colorScale' ? withEffect(orderScaleAnchors(change(effect))) : null);
  switch (action.kind) {
    case 'chooseKindOfEffect':
      return table === null ? null : ruleWithEffectKind(rule, action.effect, table);
    case 'useSelection': {
      let selectedRanges = rangesOfAreas(reads, sheetId, areasOfAllRanges(selection, reads));
      return selectedRanges === null
        ? null
        : {
            ...rule,
            ranges: selectedRanges,
          };
    }
    case 'chooseTested':
      return ruleWhere === null
        ? null
        : withEffect(
            updateRuleTest(ruleWhere.effect, action.test, (test) => {
              let testWithTested = {
                ...test,
                tested: action.tested,
              };
              let oldColumn = testedColumnSummary(rule, table, test);
              let condition = conditionForNewColumn(test.condition, testedColumnSummary(rule, table, testWithTested), oldColumn);
              let columnIndex = reads.columnIndexOf(sheetId, oldColumn.c) ?? -1;
              return action.tested.kind === 'theCellItself' &&
                areasOfRuleRanges(reads, sheetId, rule.ranges).some(
                  ({ leftColumnIndex, columnCount }) =>
                    isInSpan(columnIndex, leftColumnIndex, columnCount),
                ) &&
                'text' in condition &&
                'text' in test.condition
                ? {
                    ...testWithTested,
                    condition: {
                      ...condition,
                      text: test.condition.text,
                    },
                  }
                : {
                    ...testWithTested,
                    condition,
                  };
            }),
          );
    case 'chooseCondition':
      return changeTest(
        action.test,
        ({ condition }, column) => conditionWithOperator(action.choice, condition, column),
      );
    case 'chooseOperand':
      return changeTest(action.test, ({ condition }, column) => {
        let operand = numberConditionOperand(condition, action.slot);
        let newOperand = operand === null || table === null ? null : operandForChoice(action.choice, operand, column, table);
        return newOperand === null ? null : withOperand(condition, action.slot, newOperand);
      });
    case 'chooseOperandColumn':
      return changeTest(
        action.test,
        ({ condition }) =>
          withOperand(condition, action.slot, {
            kind: 'sameRowInColumn',
            c: action.c,
          }),
      );
    case 'chooseDay':
      return changeTest(action.test, ({ condition }) => {
        let dayNumber = dayNumberOf(reads, action.day);
        return dayNumber === null
          ? null
          : withOperand(condition, action.slot, {
              kind: 'number',
              number: dayNumber,
            });
      });
    case 'chooseText':
      return changeTest(
        action.test,
        ({ condition }) =>
          'text' in condition
            ? {
                ...condition,
                text: action.text,
              }
            : null,
      );
    case 'removeTest':
      return ruleWhere === null ? null : withEffect(removeRuleTest(ruleWhere.effect, action.test));
    case 'choosePreset':
      return withFormat(RULE_FORMAT_PRESETS.find(({ key }) => key === action.preset)?.format ?? {});
    case 'chooseColor':
      return ruleWhere === null ? null : withFormat(withFormatColor(ruleWhere.effect.format, action.property, action.color));
    case 'toggleStyle':
      return ruleWhere === null ? null : withFormat(toggleFontStyle(ruleWhere.effect.format, action.style));
    case 'chooseAnchor': {
      let { smallest: smallestValue, middle: middleValue, largest } = tableColumnSummary(table, firstColumnOfRule(rule));
      let anchorValue =
        {
          lowest: smallestValue,
          middle: middleValue,
          highest: largest,
        }[action.stop] ?? 0;
      let withAnchorAt = (anchorAt: number) =>
        changeScale((scale) => withScalePointAnchor(scale, action.stop, action.choice, anchorAt));
      return withAnchorAt(anchorValue) ?? withAnchorAt(action.stop === 'lowest' ? anchorValue - 1 : anchorValue + 1);
    }
    case 'chooseStopDay': {
      let stopDay = dayNumberOf(reads, action.day);
      return stopDay === null ? null : changeScale((scale) => withScalePointAnchor(scale, action.stop, 'number', stopDay));
    }
    case 'chooseStopColor':
      return changeScale((scale) => withScalePointColor(scale, action.stop, action.color));
    case 'setMiddleStop':
      return changeScale((scale) => withScaleMidpoint(scale, action.isOn));
    case 'addTest':
    case 'pointAtSuggestion':
    case 'takeSuggestion':
    case 'showInPane':
    case 'askForMoreSuggestions':
    case 'previewRested':
    case 'typeWords':
    case 'restAfterWords':
    case 'takeReadAtOnce':
    case 'askAgent':
    case 'keepOffer':
    case 'editOffer':
    case 'discardOffer':
    case 'stepBack':
    case 'startRule':
    case 'editRule':
    case 'removeRule':
    case 'useSelectionFor':
    case 'moveRule':
    case 'leaveEditor':
    case 'type':
    case 'enterTyped':
    case 'dropTyped':
      return null;
  }
}
export function actInRuleEditor(
  state: PageState,
  reads: WorkbookReads,
  pane: ConditionalFormatsPane,
  editor: RuleEditorState,
  action: RulesPaneAction,
): PageTransition {
  let { sheetId } = pane;
  let { conditionalFormatId, table, typed, testBeingAdded } = editor;
  let savedRule = conditionalFormatRuleById(reads, sheetId, conditionalFormatId);
  let currentRule = savedRule === null ? null : ruleWithTestBeingAdded(savedRule, testBeingAdded);
  let withEditor = (editorNow: RuleEditorState | null, paneChanges: Partial<ConditionalFormatsPane> = {}) =>
    withNoEffects(
      withConditionalFormatsPane(state, {
        ...pane,
        ...paneChanges,
        editor: editorNow,
      }),
    );
  if (action.kind === 'leaveEditor' || currentRule === null)
    return withEditor(null, {
      offer: null,
    });
  if (action.kind === 'removeRule') {
    let removal: Edit = {
      kind: 'removeConditionalFormat',
      sheetId,
      conditionalFormatId,
    };
    return {
      ...withEditor({
        ...editor,
        typed: null,
      }),
      effects: [
        queueRuleEditEffect(removal, {
          what: 'ruleRemoved',
          isSaved: false,
        }),
      ],
    };
  }
  if (action.kind === 'askAgent') return askAgentForRulesFromWords(state, reads, action.words, false);
  if (action.kind === 'discardOffer')
    return withEditor(editor, {
      offer: null,
    });
  let refusalsNotOf = (field: RuleField): RefusedTyping[] => (editor.refused ?? []).filter((refusal) => refusal.field !== field);
  if (action.kind === 'dropTyped')
    return withEditor({
      ...editor,
      typed: null,
      refused: refusalsNotOf(action.field),
    });
  let refitToRanges = (rule: RuleInIds, oldRule: RuleInIds): RuleInIds => {
    if (isSameRulesJson(rule.ranges, oldRule.ranges)) return rule;
    let oldTable = oldRule === currentRule ? table : tableOfRuleRange(reads, sheetId, oldRule);
    let retargetFrom: RuleAndTable = {
      rule: oldRule,
      table: oldTable,
    };
    let retarget = testRetargeterForRanges(reads, sheetId, rule, retargetFrom);
    let { effect: ruleEffect } = rule;
    let tableOfRule =
      retarget === null ||
      (ruleEffect.kind === 'formatWhere' && ruleEffect.allOf.some(({ tested }) => tested.kind !== 'theCellItself'))
        ? tableOfRuleRange(reads, sheetId, rule)
        : null;
    return refitTestsToRanges(rule, tableOfRule, retargetFrom, retarget);
  };
  if (action.kind === 'type') {
    let ruleWithBoxIfSame = typed?.field === action.field ? typed.ruleWithBox : null;
    let beingEdited: RuleBeingEdited = {
      rule: ruleWithBoxIfSame ?? currentRule,
      table,
      reads,
      sheetId,
    };
    let textToRead = action.field.endsWith('.text')
      ? Array.from(action.text.replace(controlCharacterPattern, ''))
          .slice(0, reads.limitsOfConditionalFormats().longestTextOfAConditionInCharacters)
          .join('')
      : action.text;
    let typedRule = ruleWithTypedField(beingEdited, action.field, textToRead);
    return withEditor({
      ...editor,
      refused: refusalsNotOf(action.field),
      typed: {
        field: action.field,
        text: textToRead,
        rule: typedRule === null ? null : refitToRanges(typedRule, beingEdited.rule),
        ruleWithBox: ruleWithBoxIfSame,
      },
    });
  }
  let chosenTest: Test | null = null;
  let saveRule = (rule: RuleInIds | null, paneChanges: Partial<ConditionalFormatsPane> = {}, notice: NoticeOfSavedRule | null = null) => {
    let done: ConditionalFormatDone | undefined =
      rule === null || notice === null
        ? undefined
        : notice === 'scaleColorsNothing'
          ? {
              what: notice,
            }
          : {
              what: notice,
              column: columnLabelOf(reads, sheetId, tableColumnSummary(table, firstColumnOfRule(rule))),
            };
    let change = rule === null ? null : conditionalFormatChangeEffect(sheetId, conditionalFormatId, currentRule, rule, done);
    let keepsPicked =
      (rule === null || isSameRulesJson(rule.ranges, currentRule.ranges)) &&
      (editor.cellsPickedByPage !== 'movedToNumbers' || rule?.effect.kind !== 'formatWhere');
    return {
      ...withEditor(
        {
          ...editor,
          typed: null,
          ...(action.kind === 'removeTest' && {
            refused: (editor.refused ?? []).filter(({ field }) => !/^\d/.test(field)),
          }),
          testBeingAdded: chosenTest ?? (change === null ? testBeingAdded : null),
          cellsPickedByPage: keepsPicked ? editor.cellsPickedByPage : notice === 'movedToNumbers' ? notice : null,
        },
        paneChanges,
      ),
      effects: change === null ? [] : [change],
    };
  };
  if (action.kind === 'enterTyped' && typed !== null && typed.rule === null && typed.text.trim() !== '') {
    let { field: unreadField, text: unreadText } = typed;
    let refusals = [
      ...refusalsNotOf(unreadField),
      {
        field: unreadField,
        text: unreadText,
        over: currentRule,
      },
    ];
    return withEditor({
      ...editor,
      typed: null,
      refused: refusals,
    });
  }
  if (action.kind === 'enterTyped') return saveRule(typed?.rule ?? null);
  if (action.kind === 'keepOffer')
    return saveRule(pane.offer?.[0] ?? null, {
      offer: null,
    });
  let ruleShown = typed?.rule ?? typed?.ruleWithBox ?? currentRule;
  let ruleWhere: FormatWhereRule | null =
    ruleShown.effect.kind === 'formatWhere'
      ? {
          ...ruleShown,
          effect: ruleShown.effect,
        }
      : null;
  if (action.kind === 'addTest') {
    let { mostTestsInAConditionalFormat: mostTests } = reads.limitsOfConditionalFormats();
    return ruleWhere === null || table === null || testBeingAdded !== null || ruleWhere.effect.allOf.length >= mostTests
      ? withNoEffects(state)
      : withEditor({
          ...editor,
          testBeingAdded: {
            tested: testOfUnusedColumn(ruleWhere, table),
            condition: null,
          },
        });
  }
  if ('test' in action && action.test === NEW_TEST_INDEX) {
    if (ruleWhere === null || testBeingAdded?.condition !== null) return withNoEffects(state);
    if (action.kind === 'chooseTested')
      return withEditor({
        ...editor,
        testBeingAdded: {
          ...testBeingAdded,
          tested: action.tested,
        },
      });
    if (action.kind === 'removeTest')
      return withEditor({
        ...editor,
        testBeingAdded: null,
      });
    if (action.kind !== 'chooseCondition') return withNoEffects(state);
    let notBlankTest: Test = {
      tested: testBeingAdded.tested,
      condition: {
        kind: 'isNotBlank',
      },
    };
    chosenTest = {
      ...notBlankTest,
      condition: conditionWithOperator(action.choice, notBlankTest.condition, testedColumnSummary(ruleShown, table, notBlankTest)),
    };
  }
  let editedRule =
    chosenTest !== null && ruleWhere !== null
      ? {
          ...ruleShown,
          effect: withAddedTest(ruleWhere.effect, chosenTest),
        }
      : ruleAfterEditorAction(
          {
            rule: ruleShown,
            table,
            reads,
            sheetId,
          },
          state,
          action,
        );
  if (editedRule === null) return withNoEffects(state);
  let refittedRule = refitToRanges(editedRule, ruleShown);
  let { effect } = refittedRule;
  let emptyTextTestIndex =
    effect.kind === 'formatWhere' ? effect.allOf.findIndex(({ condition }) => hasEmptyTextOperand(condition)) : -1;
  if (emptyTextTestIndex !== -1)
    return withEditor({
      ...editor,
      testBeingAdded: null,
      typed: {
        field: `${emptyTextTestIndex}.text`,
        text: '',
        rule: null,
        ruleWithBox: refittedRule,
      },
    });
  if (action.kind !== 'chooseKindOfEffect' || action.effect !== 'colorScale') return saveRule(refittedRule);
  let testedColumn = testedColumnOfRule(refittedRule);
  let colorsNothing = table !== null && findColumnStats(table, testedColumn)?.numbers === 0;
  return saveRule(
    refittedRule,
    {},
    testedColumn !== testedColumnOfRule(ruleShown) && !isSameRulesJson(refittedRule.ranges, ruleShown.ranges)
      ? 'movedToNumbers'
      : colorsNothing
        ? 'scaleColorsNothing'
        : null,
  );
}
export const dayNumberOf = (reads: WorkbookReads, text: string): number | null =>
  numberReadAs(
    reads,
    {
      kind: 'date',
      order: 'yearMonthDay',
      shownAs: 'yearMonthDay',
    },
    text,
  );
export const withOperand = (condition: CellCondition, slot: NumberOperandField, operand: NumberOperand): CellCondition =>
  numberConditionOperand(condition, slot) === null
    ? condition
    : {
        ...condition,
        [slot]: operand,
      };
export const controlCharacterPattern = /\p{Cc}/gu;
