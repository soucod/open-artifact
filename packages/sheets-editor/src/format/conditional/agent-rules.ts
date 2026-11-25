import { conditionalRulesOfPane, canOfferAgentForRules } from '../../state/queries.ts';
import { cleanTextForAgent, joinPrompts } from '../../agent/prompt-text.ts';
import {
  MOST_RULE_WORDS_FOR_AGENT,
  isAgentFreeForRules,
  agentAskFailed,
  rulesBriefForAgent,
  askAgentAboutRules,
  lineRunsOfSheet,
  MOST_AGENT_ATTEMPTS,
} from './ask-agent.ts';
import { withNoEffects } from '../../state/transitions.ts';
import {
  tableInPlaceOfSelection,
  isOneCellSelectedOnly,
  doesSelectionGoPastTable,
  canRulesRunToSheetEnd,
  matchesOfRules,
  withRuleRangesMapped,
  stretchRangeToAreaEnd,
} from './selection-target.ts';
import {
  conditionalFormatFromWordsPrompt,
  editConditionalFormatRulePrompt,
  suggestionsFromAnswer,
  rulesFromAnswer,
  isNoRulesAnswer,
  refusedAnswerPrompt,
} from './agent-prompts.ts';
import { selectedArea } from '../../selection/model.ts';
import {
  conditionalFormatRuleById,
  cornerCellIdsOf,
  openConditionalFormatsAs,
  withRulesOfAgentKept,
  withConditionalFormatsPane,
  cellRangeKey,
  cellsToAskAgentAbout,
  rulesOfAgentToKeep,
  isPlainRulesMenu,
  showRulesInPane,
  isSameRulesJson,
} from './pane-state.ts';
import { MAX_COMMAND_WORDS_LENGTH } from '../../ui/commands-from-words.ts';
import { areasOfRuleRanges } from './descriptions.ts';
import { isInSpan } from '../../grid/geometry.ts';
import { NUMBER_OPERAND_FIELDS, numberConditionOperand } from './editor-view.ts';
import { closeSidePane } from '../../chips/dropdowns.ts';
import type { ColumnId, ConditionalFormatAsIf, Matches, RangeCorners, RuleInIds, SheetId } from '@open-artifact/sheets-core';
import type { PagePoint } from '../../comments/page-comments.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { PageState } from '../../state/initial-state.ts';
import type { PageTransition } from '../../state/transitions.ts';
import type { NumberFormatReply } from '../custom-number-format.ts';
import type {
  AgentAbout,
  AgentFailedForRules,
  AgentForRules,
  AskForMoreSuggestions,
  ConditionalFormatsPane,
  RulesForSelection,
  RulesOfAgentByCells,
} from './pane-state.ts';
/** How the agent's reply to an ask about rules came out (the agent replies to every ask the same way). */
export type AgentReplyAboutRules = NumberFormatReply;
export function askAgentForRulesFromWords(
  state: PageState,
  reads: WorkbookReads,
  words: string,
  canChatTakeIt: boolean,
  attempt = 1,
): PageTransition {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  let wordsForAgent = cleanTextForAgent(words, MOST_RULE_WORDS_FOR_AGENT);
  let canAsk = pane !== null && (isAgentFreeForRules(pane) || (pane.agent.kind === 'isAsked' && pane.agent.about === 'moreSuggestions'));
  if (pane === null || wordsForAgent === '' || !canAsk) return withNoEffects(state);
  let paneAsking: ConditionalFormatsPane = {
    ...pane,
    offer: null,
    pointedAt: null,
    inWords: null,
  };
  let failWith = (about: AgentAbout) => agentAskFailed(state, pane, about);
  if (pane.editor === null) {
    let cornerCells: [CellId, CellId] = [state.activeCell, state.selectionCorner];
    let suggestions = reads.conditionalFormatSuggestions(...cornerCells);
    let tableInPlace =
      suggestions === null ? null : tableInPlaceOfSelection(reads, pane.sheetId, suggestions, isOneCellSelectedOnly(state, reads));
    let brief = rulesBriefForAgent(reads, ...(tableInPlace ?? cornerCells));
    if (brief === null) return failWith('request');
    let { told, linesAsTold } = brief;
    let asked = conditionalFormatFromWordsPrompt(told, wordsForAgent, state.otherRanges.length === 0, canChatTakeIt);
    let reach =
      suggestions === null || tableInPlace !== null || doesSelectionGoPastTable(reads, pane.sheetId, selectedArea(state, reads), suggestions)
        ? null
        : {
            selected: selectedArea(state, reads),
            lastRowTold: suggestions.table.records.bottomRight.r,
          };
    return askAgentAboutRules(state, paneAsking, {
      about: 'request',
      words: wordsForAgent,
      canChatTakeIt,
      asked,
      attempt,
      linesAsTold,
      reach,
    });
  }
  let editedRule = conditionalFormatRuleById(reads, pane.sheetId, pane.editor.conditionalFormatId);
  let editedBrief =
    editedRule === null ? null : rulesBriefForAgent(reads, ...cornerCellIdsOf(pane.sheetId, editedRule.ranges[0]));
  let [ruleAsTold = null] = editedRule === null ? [] : (reads.conditionalFormatsByAddress(pane.sheetId, [editedRule]) ?? []);
  if (editedBrief === null || ruleAsTold === null) return failWith('change');
  let { told: editedTold, linesAsTold: editedLinesAsTold } = editedBrief;
  let editAsked = editConditionalFormatRulePrompt(editedTold, ruleAsTold, wordsForAgent);
  return askAgentAboutRules(state, paneAsking, {
    about: 'change',
    words: wordsForAgent,
    asked: editAsked,
    attempt,
    linesAsTold: editedLinesAsTold,
  });
}
export function askRulesFromMenuWords(state: PageState, reads: WorkbookReads, words: string, menuAt: PagePoint | null): PageTransition {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  let { menu } = state;
  if (menu === null || menu.holds !== 'all' || menu.isOfContextBar === true) return withNoEffects(state);
  if (menu.at !== menuAt) return withNoEffects(state);
  if (pane === null ? !canOfferAgentForRules(state) : pane.drawnAs !== 'menu') return withNoEffects(state);
  let menuWords = cleanTextForAgent(words, MAX_COMMAND_WORDS_LENGTH);
  if (menuWords === '' || pane?.wordsOfMenu === menuWords) return withNoEffects(state);
  let menuPane: ConditionalFormatsPane | null = pane === null ? conditionalRulesOfPane(openConditionalFormatsAs(state, 'menu')) : withRulesOfAgentKept(state, pane);
  if (menuPane === null) return withNoEffects(state);
  let paneWithWords: ConditionalFormatsPane = {
    ...menuPane,
    wordsOfMenu: menuWords,
    offer: null,
    agent: {
      kind: 'isIdle',
    },
  };
  let stateNow: PageState =
    menuPane.offer === null
      ? state
      : {
          ...state,
          lastDone: {
            what: 'offerDiscarded',
          },
        };
  let asked = askAgentForRulesFromWords(
    withConditionalFormatsPane(
      {
        ...stateNow,
        dropdown: null,
      },
      paneWithWords,
    ),
    reads,
    menuWords,
    false,
  );
  return menuPane.agent.kind === 'isAsked' && conditionalRulesOfPane(asked.state)?.agent.kind !== 'isAsked'
    ? {
        ...asked,
        effects: [
          {
            kind: 'stopAskingAgentAboutConditionalFormats',
          },
          ...asked.effects,
        ],
      }
    : asked;
}
export function showRulesInMenu(state: PageState, menuAt: PagePoint | null): PageState {
  let { menu } = state;
  if (menu === null || menu.holds !== 'all' || menu.isOfContextBar === true) return state;
  if (menu.at !== menuAt || state.sidePane !== null) return state;
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(openConditionalFormatsAs(state, 'menu'));
  if (pane === null) return state;
  let agent: AgentForRules =
    pane.agent.kind === 'isAsked'
      ? {
          kind: 'isIdle',
        }
      : pane.agent;
  return withConditionalFormatsPane(
    {
      ...state,
      dropdown: null,
    },
    {
      ...pane,
      agent,
    },
  );
}
export function isUsefulSuggestion(
  reads: WorkbookReads,
  sheetId: SheetId,
  rules: RuleInIds[],
  matchTotal: Matches | null = matchTotalOfRules(reads, sheetId, rules),
): boolean {
  if (rules.every(({ effect }) => effect.kind === 'colorScale')) return true;
  let cellCount = rules
    .flatMap(({ ranges }) => areasOfRuleRanges(reads, sheetId, ranges))
    .reduce((total, { rowCount, columnCount }) => total + rowCount * columnCount, 0);
  return matchTotal !== null && matchTotal.cells > 0 && (rules.length > 1 || matchTotal.cells <= MOST_SHARE_OF_CELLS_MATCHED * cellCount);
}
export function areRulesWithinRows(reads: WorkbookReads, sheetId: SheetId, range: RangeCorners, rules: RuleInIds[]): boolean {
  let [area] = areasOfRuleRanges(reads, sheetId, [range]);
  return (
    area !== undefined &&
    rules.every(
      ({ ranges }) =>
        areasOfRuleRanges(reads, sheetId, ranges).every(
          ({ topRowIndex, rowCount }) =>
            topRowIndex >= area.topRowIndex && topRowIndex + rowCount <= area.topRowIndex + area.rowCount,
        ),
    )
  );
}
export function doRulesTouchColumns(reads: WorkbookReads, sheetId: SheetId, range: RangeCorners, rules: RuleInIds[]): boolean {
  let [
    { leftColumnIndex, columnCount } = {
      leftColumnIndex: 0,
      columnCount: 0,
    },
  ] = areasOfRuleRanges(reads, sheetId, [range]);
  let isColumnInRange = (columnId: ColumnId) =>
    isInSpan(reads.columnIndexOf(sheetId, columnId) ?? -1, leftColumnIndex, columnCount);
  return rules.some(({ ranges, effect }) => {
    let overlapsRange = areasOfRuleRanges(reads, sheetId, ranges).some(
      (area) => area.leftColumnIndex < leftColumnIndex + columnCount && leftColumnIndex < area.leftColumnIndex + area.columnCount,
    );
    if (effect.kind === 'colorScale') return overlapsRange;
    return effect.allOf.some(
      ({ tested, condition }) =>
        (tested.kind === 'theCellItself' ? overlapsRange : isColumnInRange(tested.c)) ||
        NUMBER_OPERAND_FIELDS.some((operandKey) => {
          let operand = numberConditionOperand(condition, operandKey);
          return operand?.kind === 'sameRowInColumn' && isColumnInRange(operand.c);
        }),
    );
  });
}
export function agentRulesByColumn(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topLeft, bottomRight }: RangeCorners,
  rules: RuleInIds[][],
): RulesOfAgentByCells {
  let [area] = areasOfRuleRanges(reads, sheetId, [
    {
      topLeft,
      bottomRight,
    },
  ]);
  let columns = reads.linesOf(sheetId)?.columns;
  if (area === undefined || columns === undefined || area.columnCount < 2) return {};
  return Object.fromEntries(
    Array.from(
      {
        length: area.columnCount,
      },
      (unfilledSpot, offset) => columns.idAt(area.leftColumnIndex + offset),
    )
      .flatMap(
        (columnId) =>
          columnId === null
            ? []
            : [
                {
                  topLeft: {
                    ...topLeft,
                    c: columnId,
                  },
                  bottomRight: {
                    ...bottomRight,
                    c: columnId,
                  },
                },
              ],
      )
      .map(
        (columnRange): [string, RuleInIds[][]] => [
          cellRangeKey(columnRange),
          rules.filter((suggestedRules) => doRulesTouchColumns(reads, sheetId, columnRange, suggestedRules)),
        ],
      )
      .filter(([, columnRules]) => columnRules.length > 0),
  );
}
export function isAgentAnswerForCells(
  reads: WorkbookReads,
  sheetId: SheetId,
  { forCells, areWholeColumns }: Pick<AskForMoreSuggestions, 'forCells' | 'areWholeColumns'>,
  forSelection: RulesForSelection,
): boolean {
  let { topLeft, bottomRight } = cellsToAskAgentAbout(forSelection);
  if (
    cellRangeKey({
      topLeft,
      bottomRight,
    }) === cellRangeKey(forCells)
  )
    return true;
  let [forCellsArea] = areasOfRuleRanges(reads, sheetId, [forCells]);
  return (
    areWholeColumns &&
    forCellsArea !== undefined &&
    topLeft.c === bottomRight.c &&
    topLeft.r === forCells.topLeft.r &&
    bottomRight.r === forCells.bottomRight.r &&
    isInSpan(reads.columnIndexOf(sheetId, topLeft.c) ?? -1, forCellsArea.leftColumnIndex, forCellsArea.columnCount)
  );
}
export function takeAgentAnswerForKeptRules(state: PageState, reads: WorkbookReads, askId: number, answer: AgentReplyAboutRules): PageState {
  let kept = state.rulesOfAgentKept;
  if (kept === null || kept.stillAsked?.askId !== askId) return state;
  let stateWithAnswer: PageState = {
    ...state,
    isAgentForRulesNotToBeHad: answer.kind === 'notToBeHad',
    rulesOfAgentKept: {
      ...kept,
      stillAsked: null,
    },
  };
  let reopened = openConditionalFormatsAs(
    {
      ...state,
      sheetId: kept.sheetId,
    },
    'card',
  );
  if (conditionalRulesOfPane(reopened)?.agent !== kept.stillAsked) return stateWithAnswer;
  let paneAfter = conditionalRulesOfPane(takeAgentAnswerAboutRules(reopened, reads, askId, answer).state);
  return paneAfter === null
    ? stateWithAnswer
    : {
        ...stateWithAnswer,
        rulesOfAgentKept: rulesOfAgentToKeep(state, paneAfter),
      };
}
export function takeAgentAnswerAboutRules(state: PageState, reads: WorkbookReads, askId: number, answer: AgentReplyAboutRules): PageTransition {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  if (pane === null || isPlainRulesMenu(pane)) return withNoEffects(takeAgentAnswerForKeptRules(state, reads, askId, answer));
  if (pane.agent.kind !== 'isAsked' || pane.agent.askId !== askId) return withNoEffects(state);
  let stateWithAnswer = {
    ...state,
    isAgentForRulesNotToBeHad: answer.kind === 'notToBeHad',
  };
  let agent = pane.agent;
  let { asked, attempt } = agent;
  let withAgent = (agentNow: AgentForRules, paneChanges: Partial<ConditionalFormatsPane> = {}) =>
    withNoEffects(
      withConditionalFormatsPane(stateWithAnswer, {
        ...pane,
        ...paneChanges,
        agent: agentNow,
      }),
    );
  if (answer.kind === 'notToBeHad') {
    let paneWithNoAgent: ConditionalFormatsPane = {
      ...pane,
      agent: {
        kind: 'isNotToBeHad',
      },
    };
    return withNoEffects(
      pane.drawnAs === 'card' ? showRulesInPane(stateWithAnswer, paneWithNoAgent) : withConditionalFormatsPane(stateWithAnswer, paneWithNoAgent),
    );
  }
  let isSameLines = isSameRulesJson(lineRunsOfSheet(reads, pane.sheetId), agent.linesAsTold);
  let failed: AgentFailedForRules = {
    kind: 'hasFailed',
    about: agent.about,
    isBeyondRules: false,
  };
  if (agent.about === 'moreSuggestions') {
    if (answer.kind !== 'answered' || !isSameLines) return withAgent(failed);
    let suggestedRules = suggestionsFromAnswer(answer.answer).flatMap((ids) => {
      let found = reads.conditionalFormatsInIds(pane.sheetId, ids);
      let [firstRule, ...otherRules] = found?.kind === 'rules' ? found.rules : [];
      if (firstRule === undefined) return [];
      let rules = [firstRule, ...otherRules];
      return doRulesTouchColumns(reads, pane.sheetId, agent.forCells, rules) &&
        areRulesWithinRows(reads, pane.sheetId, agent.forCells, rules) &&
        isUsefulSuggestion(reads, pane.sheetId, rules)
        ? [rules]
        : [];
    });
    if (suggestedRules.length === 0 && answer.isMended === true) return withAgent(failed);
    let fromAgent = {
      ...(agent.areWholeColumns ? agentRulesByColumn(reads, pane.sheetId, agent.forCells, suggestedRules) : {}),
      ...pane.fromAgent,
      [cellRangeKey(agent.forCells)]: suggestedRules,
    };
    return withAgent(
      {
        kind: 'isIdle',
      },
      {
        fromAgent,
      },
    );
  }
  if (!isSameLines)
    return attempt >= MOST_AGENT_ATTEMPTS
      ? withAgent(failed)
      : askAgentForRulesFromWords(
          withAgent({
            kind: 'isIdle',
          }).state,
          reads,
          agent.words,
          agent.about === 'request' && agent.canChatTakeIt,
          attempt + 1,
        );
  let answerRules = answer.kind === 'answered' ? rulesFromAnswer(answer.answer) : null;
  if (answer.kind === 'answered' && answer.isMended !== true && agent.about === 'request' && isNoRulesAnswer(answer.answer))
    return withAgent({
      ...failed,
      isBeyondRules: true,
    });
  if (answer.kind !== 'answered' || answerRules === null) return withAgent(failed);
  let rulesFound = reads.conditionalFormatsInIds(pane.sheetId, answerRules);
  if (rulesFound === null) return withAgent(failed);
  if (rulesFound.kind === 'rules') {
    let [firstRule, ...otherRules] = rulesFound.rules;
    if (firstRule === undefined) return withAgent(failed);
    if (agent.about === 'change')
      return withAgent(
        {
          kind: 'isIdle',
        },
        {
          offer: [firstRule],
        },
      );
    let rules = [firstRule, ...otherRules];
    let runsToSheetEnd =
      agent.reach !== null && canRulesRunToSheetEnd(reads, pane.sheetId, agent.reach.lastRowTold, rules, matchesOfRules(reads, pane.sheetId, rules));
    let offer =
      agent.reach !== null && runsToSheetEnd ? withRuleRangesMapped(rules, stretchRangeToAreaEnd(reads, pane.sheetId, agent.reach.selected)) : rules;
    return withAgent(
      {
        kind: 'isIdle',
      },
      {
        offer,
      },
    );
  }
  if (attempt >= MOST_AGENT_ATTEMPTS || answer.isMended === true) return withAgent(failed);
  return askAgentAboutRules(stateWithAnswer, pane, {
    ...agent,
    asked: joinPrompts(asked, refusedAnswerPrompt(answer.answer, rulesFound)),
    attempt: attempt + 1,
  });
}
export const closeRulesMenu = (state: PageState): PageState =>
  conditionalRulesOfPane(state)?.drawnAs === 'menu' ? closeSidePane(state) : state;
export const asNewRules = (rules: RuleInIds[]): ConditionalFormatAsIf[] =>
  rules.map(
    (rule) => ({
      ...rule,
      inPlaceOf: null,
    }),
  );
export const sumMatches = (matches: (Matches | null)[]): Matches | null =>
  matches.reduce<Matches | null>(
    (total, match) =>
      match === null
        ? total
        : {
            cells: (total?.cells ?? 0) + match.cells,
            rows: (total?.rows ?? 0) + match.rows,
          },
    null,
  );
export const matchTotalOfRules = (reads: WorkbookReads, sheetId: SheetId, rules: RuleInIds[]): Matches | null =>
  sumMatches(matchesOfRules(reads, sheetId, rules) ?? []);
export const MOST_SHARE_OF_CELLS_MATCHED = 0.9;
