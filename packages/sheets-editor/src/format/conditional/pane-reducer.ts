import { selectedArea, isSameSelection } from '../../selection/model.ts';
import { readConditionalFormatFromWords } from '../../words/rule-in-table.ts';
import {
  isOneCellSelectedOnly,
  canRulesRunToSheetEnd,
  withRuleRangesMapped,
  stretchRangeToAreaEnd,
  rulesForSelection,
  originalRulesOf,
  matchesOfRules,
  originalOfStretchedRules,
} from './selection-target.ts';
import { tintFormatOf, defaultRuleForRanges, ruleWithEffectKind } from './rule-edits.ts';
import {
  isSameRulesJson,
  withConditionalFormatsPane,
  showRulesInPane,
  queueRuleEditEffect,
  tableOfRuleRange,
  stepBackInRulesPane,
  isAskingAgentForRules,
  conditionalFormatRuleById,
  ruleOfConditionalFormat,
  whatRuleLooksFor,
  NOTHING_SHOWN_IN_RULES_PANE,
  isCardFarFromSelection,
  cellRangeKey,
  cellsToAskAgentAbout,
  areSameRulesIgnoringFormat,
  ruleWithTestBeingAdded,
  conditionalFormatChangeEffect,
  isPlainRulesMenu,
  rulesOfAgentToKeep,
  isAgentOfferPendingOrAsked,
} from './pane-state.ts';
import { asNewRules, askAgentForRulesFromWords, sumMatches, doRulesTouchColumns, isAgentAnswerForCells } from './agent-rules.ts';
import { closeSidePane } from '../../chips/dropdowns.ts';
import { withNoEffects } from '../../state/transitions.ts';
import { askAgentForMoreSuggestions } from './ask-agent.ts';
import { rangesOfAreas, actInRuleEditor } from './editor-edits.ts';
import { areasOfAllRanges } from '../../selection/several-ranges.ts';
import { firstColumnOfRule } from './conditions.ts';
import { columnLabelOf, tableColumnSummary, conditionalFormatEditorView, conditionalFormatFieldValue } from './editor-view.ts';
import { openRuleEditor, PAGE_SUGGESTIONS_BESIDE_AGENT, PAGE_SUGGESTIONS_FOR_BLOCK, columnNameOfAbout } from './suggestions.ts';
import { conditionalRulesOfPane } from '../../state/queries.ts';
import { areasOfRuleRanges, describeRules, describeRule } from './descriptions.ts';
import { areasToA1AsStored } from '../../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../../model/line-ids.ts';
import type { ConditionalFormatAsIf, ConditionalFormatSuggestion, Edit, Matches, RangeCorners, RuleInIds } from '@open-artifact/sheets-core';
import type { FormatsGiven, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { PageEffect, PageTransition } from '../../state/transitions.ts';
import type { IfQueued, PageContext } from '../../state/event-reducer.ts';
import type { ConditionalFormatDone } from '../../messages/conditional-format.ts';
import type {
  ConditionalFormatsPane,
  KeptRulesOfAgent,
  RuleEditorState,
  RulesInWords,
  RulesPaneAction,
  ShownRulesWithEach,
  ShownSuggestion,
} from './pane-state.ts';
import type { PageState } from '../../state/initial-state.ts';
/** What settling the pane after an event needs to know of the page. */
export type PaneSettling = Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>;
export function inWordsOfPane(
  state: PageState,
  reads: WorkbookReads,
  pane: Pick<ConditionalFormatsPane, 'sheetId' | 'forSelection' | 'inWords'>,
  { words, today: todayAsIso }: Pick<RulesInWords, 'words' | 'today'>,
  mayKeepRead = true,
): RulesInWords | null {
  if (words.trim() === '') return null;
  const { sheetId, forSelection, inWords } = pane;
  let tableCorner = forSelection?.table.records.topLeft;
  let effectToStartFrom = forSelection?.ruleToStartFrom.effect;
  let selected = selectedArea(state, reads);
  let read = readConditionalFormatFromWords(reads, words, {
    inTable:
      tableCorner === undefined
        ? state.activeCell
        : {
            sheetId,
            rowId: tableCorner.r,
            columnId: tableCorner.c,
          },
    selected: state.otherRanges.length > 0 ? null : selected,
    isOneCellSelected: isOneCellSelectedOnly(state, reads),
    viewer: state.viewerId,
    today: todayAsIso,
    lookToStartFrom: effectToStartFrom?.kind === 'formatWhere' ? effectToStartFrom.format : tintFormatOf('yellow'),
  });
  if (read.kind === 'notRead') {
    const isStillTyping = read.isOnItsWay && inWords !== null && words.startsWith(inWords.words);
    return {
      words,
      today: todayAsIso,
      read: null,
      stillTried: isStillTyping ? (inWords.read?.rules ?? inWords.stillTried) : null,
    };
  }
  let keptRead = mayKeepRead ? (inWords?.read ?? null) : null;
  if (keptRead !== null && isSameRulesJson(keptRead.asSaid, read.rules))
    return {
      words,
      today: todayAsIso,
      read: keptRead,
      stillTried: null,
    };
  let given = reads.formatsGivenAsIf(sheetId, asNewRules(read.rules));
  if (given === null)
    return {
      words,
      today: todayAsIso,
      read: null,
      stillTried: null,
    };
  let matches = given.matches.slice(0, read.rules.length);
  let rules =
    read.endAtLastRecord &&
    forSelection !== null &&
    forSelection.isInPlaceOfWhatIsSelected !== true &&
    forSelection.isOverSeveralTables !== true &&
    canRulesRunToSheetEnd(reads, sheetId, read.rules[0].ranges[0].bottomRight.r, read.rules, matches)
      ? withRuleRangesMapped(read.rules, stretchRangeToAreaEnd(reads, sheetId, selected))
      : read.rules;
  return {
    words,
    today: todayAsIso,
    read: {
      rules,
      asSaid: read.rules,
      gives: given,
    },
    stillTried: null,
  };
}
export function actInRulesList(state: PageState, reads: WorkbookReads, pane: ConditionalFormatsPane, action: RulesPaneAction): PageTransition {
  let { sheetId } = pane;
  let addRules = (
    rules: RuleInIds[],
    paneChanges: Partial<ConditionalFormatsPane>,
    then?: Partial<IfQueued>,
    done: ConditionalFormatDone = {
      what: 'rulesAdded',
      ruleCount: rules.length,
    },
  ): PageTransition => ({
    state:
      pane.drawnAs === 'pane'
        ? withConditionalFormatsPane(state, {
            ...pane,
            ...paneChanges,
          })
        : then === undefined
          ? closeSidePane(
              pane.drawnAs === 'menu'
                ? {
                    ...state,
                    menu: null,
                  }
                : state,
            )
          : showRulesInPane(state, {
              ...pane,
              ...paneChanges,
            }),
    effects: [
      queueRuleEditEffect(
        {
          kind: 'addConditionalFormats',
          sheetId,
          rules,
        },
        done,
        then,
      ),
    ],
  });
  let suggestedRulesOf = (rules: RuleInIds[] | null) =>
    rules === null
      ? null
      : ((
          pane.shown.suggestions.find(({ rules: suggestionRules }) => suggestionRules === rules) ??
          pane.shown.suggestions.find(({ rules: suggestionRules }) => isSameRulesJson(suggestionRules, rules))
        )?.rules ?? null);
  switch (action.kind) {
    case 'pointAtSuggestion': {
      let suggestionPointedAt = suggestedRulesOf(action.rules);
      return withNoEffects(
        suggestionPointedAt === pane.pointedAt
          ? state
          : withConditionalFormatsPane(state, {
              ...pane,
              pointedAt: suggestionPointedAt,
            }),
      );
    }
    case 'takeSuggestion': {
      let suggestionTaken = suggestedRulesOf(action.rules);
      return suggestionTaken === null
        ? withNoEffects(state)
        : addRules(suggestionTaken, {
            pointedAt: null,
          });
    }
    case 'showInPane': {
      if (pane.drawnAs === 'pane') return withNoEffects(state);
      let stillPointedAt = pane.drawnAs === 'menu' ? null : pane.pointedAt;
      return withNoEffects(
        showRulesInPane(state, {
          ...pane,
          pointedAt: stillPointedAt,
          isAskedForRules: true,
        }),
      );
    }
    case 'askForMoreSuggestions':
      return askAgentForMoreSuggestions(state, reads);
    case 'typeWords':
      return withNoEffects(
        withConditionalFormatsPane(state, {
          ...pane,
          pointedAt: null,
          inWords: inWordsOfPane(state, reads, pane, action),
        }),
      );
    case 'restAfterWords': {
      if (pane.inWords?.words !== action.words || pane.inWords.read !== null) return withNoEffects(state);
      let { words: wordsTyped, today: dayTyped } = pane.inWords;
      let wordsRead = inWordsOfPane(state, reads, pane, {
        words: `${wordsTyped} `,
        today: dayTyped,
      });
      return withNoEffects(
        withConditionalFormatsPane(state, {
          ...pane,
          inWords:
            wordsRead === null
              ? null
              : {
                  ...wordsRead,
                  stillTried: null,
                },
        }),
      );
    }
    case 'takeReadAtOnce': {
      let readNow =
        (pane.inWords?.words === action.words ? pane.inWords.read : null) ??
        inWordsOfPane(state, reads, pane, {
          ...action,
          words: `${action.words} `,
        })?.read ??
        null;
      return readNow === null
        ? askAgentForRulesFromWords(state, reads, action.words, action.canChatTakeIt ?? false)
        : addRules(readNow.rules, {
            inWords: null,
            pointedAt: null,
          });
    }
    case 'askAgent':
      return askAgentForRulesFromWords(state, reads, action.words, action.canChatTakeIt ?? false);
    case 'keepOffer':
      return pane.offer === null
        ? withNoEffects(state)
        : addRules(pane.offer, {
            offer: null,
          });
    case 'editOffer':
      return pane.offer === null
        ? withNoEffects(state)
        : addRules(
            pane.offer,
            {
              offer: null,
            },
            {
              thenEditorOfTopRule: {
                cellsPickedByPage: null,
              },
            },
          );
    case 'discardOffer':
      return withNoEffects(
        withConditionalFormatsPane(state, {
          ...pane,
          offer: null,
        }),
      );
    case 'startRule': {
      let selectedRanges = rangesOfAreas(reads, sheetId, areasOfAllRanges(state, reads));
      let ruleToStartFrom = pane.forSelection?.ruleToStartFrom ?? (selectedRanges === null ? null : defaultRuleForRanges(selectedRanges));
      if (ruleToStartFrom === null) return withNoEffects(state);
      let tableOfStart = action.effect === undefined ? null : tableOfRuleRange(reads, sheetId, ruleToStartFrom);
      let ruleStarted =
        (action.effect === undefined || tableOfStart === null ? null : ruleWithEffectKind(ruleToStartFrom, action.effect, tableOfStart)) ??
        ruleToStartFrom;
      if (action.effect !== undefined && ruleStarted.effect.kind !== action.effect) return withNoEffects(state);
      let isMovedToNumbers = firstColumnOfRule(ruleStarted) !== firstColumnOfRule(ruleToStartFrom);
      return addRules(
        [ruleStarted],
        {
          offer: null,
          pointedAt: null,
        },
        {
          thenEditorOfTopRule: {
            cellsPickedByPage: isMovedToNumbers ? 'movedToNumbers' : null,
          },
        },
        isMovedToNumbers
          ? {
              what: 'movedToNumbers',
              column: columnLabelOf(reads, sheetId, tableColumnSummary(tableOfStart, firstColumnOfRule(ruleStarted))),
            }
          : undefined,
      );
    }
    case 'editRule':
      return withNoEffects(openRuleEditor(state, reads, action.conditionalFormatId, null));
    case 'removeRule': {
      let { conditionalFormatId: removedId } = action;
      return {
        state,
        effects: [
          queueRuleEditEffect(
            {
              kind: 'removeConditionalFormat',
              sheetId,
              conditionalFormatId: removedId,
            },
            {
              what: 'ruleRemoved',
              isSaved: false,
            },
          ),
        ],
      };
    }
    case 'useSelectionFor': {
      let { conditionalFormatId: changedId } = action;
      let rangesSelected = rangesOfAreas(reads, sheetId, areasOfAllRanges(state, reads));
      if (rangesSelected === null) return withNoEffects(state);
      return {
        state,
        effects: [
          queueRuleEditEffect(
            {
              kind: 'changeConditionalFormat',
              sheetId,
              conditionalFormatId: changedId,
              ranges: rangesSelected,
            },
            {
              what: 'ruleChanged',
            },
          ),
        ],
      };
    }
    case 'moveRule': {
      let { conditionalFormatId: movedId, toIndex: newIndex } = action;
      let ruleIds = pane.shown.rules.map((rule) => rule.conditionalFormatId);
      if (!ruleIds.includes(movedId) || ruleIds[newIndex] === movedId) return withNoEffects(state);
      let beforeId = ruleIds.filter((conditionalFormatId) => conditionalFormatId !== movedId)[newIndex] ?? null;
      let moveEdit: Edit = {
        kind: 'moveConditionalFormat',
        sheetId,
        conditionalFormatId: movedId,
        before: beforeId,
      };
      let movedDone: ConditionalFormatDone = {
        what: 'ruleMoved',
        place: Math.min(newIndex, ruleIds.length - 1) + 1,
        ruleCount: ruleIds.length,
      };
      return {
        state,
        effects: [queueRuleEditEffect(moveEdit, movedDone)],
      };
    }
    case 'previewRested':
    case 'stepBack':
      return withNoEffects(state);
    case 'leaveEditor':
    case 'chooseKindOfEffect':
    case 'type':
    case 'enterTyped':
    case 'dropTyped':
    case 'useSelection':
    case 'chooseTested':
    case 'chooseCondition':
    case 'chooseOperand':
    case 'chooseOperandColumn':
    case 'chooseDay':
    case 'chooseText':
    case 'addTest':
    case 'removeTest':
    case 'choosePreset':
    case 'chooseColor':
    case 'toggleStyle':
    case 'chooseAnchor':
    case 'chooseStopDay':
    case 'chooseStopColor':
    case 'setMiddleStop':
      return withNoEffects(state);
  }
}
export function actInConditionalFormats(state: PageState, reads: WorkbookReads, action: RulesPaneAction): PageTransition {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  if (pane === null) return withNoEffects(state);
  if (pane.drawnAs === 'menu' && !isActionForMenu(pane, action)) return withNoEffects(state);
  if (action.kind === 'previewRested') {
    let { sheetId, tried } = pane;
    return withNoEffects(
      isPreviewBehind(pane)
        ? withConditionalFormatsPane(state, {
            ...pane,
            previewed: {
              asIf: tried,
              gives: reads.formatsGivenAsIf(sheetId, tried),
            },
          })
        : state,
    );
  }
  let acted =
    action.kind === 'stepBack'
      ? stepBackInRulesPane(state, pane)
      : pane.editor === null
        ? actInRulesList(state, reads, pane, action)
        : actInRuleEditor(state, reads, pane, pane.editor, action);
  return pane.offer !== null && conditionalRulesOfPane(acted.state)?.offer === null && action.kind !== 'keepOffer' && action.kind !== 'editOffer'
    ? {
        ...acted,
        state: {
          ...acted.state,
          lastDone: {
            what: 'offerDiscarded',
          },
        },
      }
    : acted;
}
export function rulesToTryOf(
  pane: Pick<ConditionalFormatsPane, 'editor' | 'offer' | 'pointedAt' | 'inWords' | 'agent'>,
): ConditionalFormatAsIf[] {
  let { editor, offer, pointedAt } = pane;
  let inWords = isAskingAgentForRules(pane) ? null : pane.inWords;
  if (editor === null) return asNewRules(offer ?? pointedAt ?? inWords?.read?.rules ?? inWords?.stillTried ?? []);
  let rule = offer?.[0] ?? editor.typed?.rule ?? null;
  return rule === null
    ? []
    : [
        {
          ...rule,
          inPlaceOf: editor.conditionalFormatId,
        },
      ];
}
export function keepTestBeingAddedIfFits(reads: WorkbookReads, { effect }: Pick<RuleInIds, 'effect'>, editor: RuleEditorState): RuleEditorState {
  let { testBeingAdded, table } = editor;
  let tested = testBeingAdded?.tested ?? null;
  return tested !== null &&
    testBeingAdded?.condition === null &&
    effect.kind === 'formatWhere' &&
    effect.allOf.length < reads.limitsOfConditionalFormats().mostTestsInAConditionalFormat &&
    (tested.kind === 'theCellItself' || table?.columns.some(({ c }) => c === tested.c) === true)
    ? editor
    : {
        ...editor,
        testBeingAdded: null,
      };
}
export function refreshConditionalFormatsPane(
  state: PageState,
  reads: WorkbookReads,
  pane: ConditionalFormatsPane,
  isSelectionSame: boolean,
  isWorkbookUnchanged: boolean,
): ConditionalFormatsPane {
  let { sheetId } = pane;
  let conditionalFormats = reads.conditionalFormatsOf(sheetId);
  let editedRule = pane.editor === null ? null : conditionalFormatRuleById(reads, sheetId, pane.editor.conditionalFormatId);
  let editor =
    pane.editor === null || editedRule === null || isWorkbookUnchanged
      ? pane.editor
      : keepTestBeingAddedIfFits(reads, editedRule, {
          ...pane.editor,
          table: tableOfRuleRange(reads, sheetId, editedRule),
        });
  let forSelection =
    editor !== null || (isSelectionSame && isWorkbookUnchanged && pane.forSelection !== null)
      ? pane.forSelection
      : rulesForSelection(reads, state.activeCell, state.selectionCorner, selectedArea(state, reads), isOneCellSelectedOnly(state, reads));
  let inWords =
    pane.inWords === null || (isWorkbookUnchanged && forSelection === pane.forSelection)
      ? pane.inWords
      : inWordsOfPane(
          state,
          reads,
          {
            ...pane,
            forSelection,
          },
          pane.inWords,
          false,
        );
  let rulesToTry = rulesToTryOf({
    ...pane,
    editor,
    inWords,
  });
  let tried = isSameRulesJson(pane.tried, rulesToTry) ? pane.tried : rulesToTry;
  let isPreviewOfTried = pane.previewed?.asIf === tried;
  let isOnlyWords = editor === null && pane.offer === null && pane.pointedAt === null;
  let previewed =
    tried.length === 0
      ? null
      : isWorkbookUnchanged && (isPreviewOfTried || !isOnlyWords)
        ? pane.previewed
        : isPreviewOfTried || isOnlyWords
          ? {
              asIf: tried,
              gives: (isOnlyWords ? inWords?.read?.gives : undefined) ?? reads.formatsGivenAsIf(sheetId, tried),
            }
          : null;
  let isPreviewCurrent = previewed?.asIf === tried;
  let given = previewed?.gives ?? null;
  let { matches } = given ?? reads.formatsGivenIn(sheetId);
  let existingRules = conditionalFormats.flatMap((format) => ruleOfConditionalFormat(format) ?? []);
  let isSameRangeToEmptyEnd = (range: RangeCorners, otherRange: RangeCorners) => {
    let [area] = areasOfRuleRanges(reads, sheetId, [range]);
    let [otherArea] = areasOfRuleRanges(reads, sheetId, [otherRange]);
    if (area === undefined || otherArea === undefined) return false;
    let belowRowIndex = otherArea.topRowIndex + otherArea.rowCount;
    let below = {
      ...otherArea,
      topRowIndex: belowRowIndex,
      rowCount: area.rowCount - otherArea.rowCount,
    };
    return (
      isSameRulesJson(
        {
          ...area,
          rowCount: 0,
        },
        {
          ...otherArea,
          rowCount: 0,
        },
      ) &&
      (below.rowCount === 0 || (below.rowCount > 0 && reads.cellsOnShowIn(sheetId, below).length === 0))
    );
  };
  let isAlreadyAdded = (rules: RuleInIds[]) =>
    originalRulesOf(rules).every(
      (rule) =>
        existingRules.some(
          (existing) =>
            isSameRulesJson(whatRuleLooksFor(existing), whatRuleLooksFor(rule)) &&
            existing.ranges.length === rule.ranges.length &&
            rule.ranges.every((range, rangeIndex) => {
              let existingRange = existing.ranges[rangeIndex];
              return existingRange !== undefined && isSameRangeToEmptyEnd(existingRange, range);
            }),
        ),
    );
  let asSuggestion = (rules: RuleInIds[], matched: Matches | null, isFromAgent: boolean): ShownSuggestion => ({
    rules,
    toSay: describeRules(reads, sheetId, rules, matched),
    isFromAgent,
  });
  let shownBefore = isWorkbookUnchanged ? pane.shown.suggestions : [];
  let keepsShownRules = isWorkbookUnchanged && pane.shown !== NOTHING_SHOWN_IN_RULES_PANE && previewed === pane.previewed;
  let shownSuggestionFor = (rules: RuleInIds[], matched: Matches | null) =>
    shownBefore.find((suggestion) => suggestion.rules === rules) ?? asSuggestion(rules, matched, true);
  let isCardFar = isCardFarFromSelection({
    ...pane,
    forSelection,
  });
  let isMenuInPlace = pane.drawnAs === 'menu' && (forSelection?.isInPlaceOfWhatIsSelected === true || state.otherRanges.length > 0);
  let pageSuggestions = (isCardFar || isMenuInPlace ? [] : (forSelection?.suggestions ?? []))
    .filter(({ rules }) => !isAlreadyAdded(rules))
    .slice(
      0,
      pane.agent.kind !== 'isNotToBeHad' && pane.drawnAs !== 'menu'
        ? PAGE_SUGGESTIONS_BESIDE_AGENT
        : forSelection?.about.topLeft.c === forSelection?.about.bottomRight.c
          ? undefined
          : PAGE_SUGGESTIONS_FOR_BLOCK,
    );
  let rulesOfAgent =
    forSelection === null || isCardFar || pane.drawnAs === 'menu' ? [] : (pane.fromAgent[cellRangeKey(cellsToAskAgentAbout(forSelection))] ?? []);
  let agentForSelection = isWorkbookUnchanged && pane.ofAgentForSelection?.written === rulesOfAgent ? pane.ofAgentForSelection : null;
  let agentMatches =
    agentForSelection?.ofEach ??
    rulesOfAgent.map((rules) => {
      let matchesOfEach = matchesOfRules(reads, sheetId, rules);
      let lastRowId = forSelection === null ? undefined : cellsToAskAgentAbout(forSelection).bottomRight.r;
      return {
        matches: sumMatches(matchesOfEach ?? []),
        mayGoOn: lastRowId !== undefined && canRulesRunToSheetEnd(reads, sheetId, lastRowId, rules, matchesOfEach),
      };
    });
  let stretchRange = stretchRangeToAreaEnd(
    reads,
    sheetId,
    forSelection?.isInPlaceOfWhatIsSelected === true || forSelection?.isOverSeveralTables === true ? null : selectedArea(state, reads),
  );
  let agentListed =
    agentForSelection !== null && forSelection === pane.forSelection
      ? agentForSelection.listed
      : rulesOfAgent.map((rules, index) => {
          let stretched = agentMatches[index]?.mayGoOn === true ? withRuleRangesMapped(rules, stretchRange) : rules;
          if (stretched !== rules) originalOfStretchedRules.set(stretched, rules);
          return stretched;
        });
  let agentSuggestions = agentListed.map(
    (rules, index) => ({
      rules,
      matched: agentMatches[index]?.matches ?? null,
      goesByWhatIsSelected: forSelection === null || doRulesTouchColumns(reads, sheetId, forSelection.about, originalRulesOf(rules)),
    }),
  );
  let agentSuggestionsInOrder = [
    ...agentSuggestions.filter(({ goesByWhatIsSelected }) => goesByWhatIsSelected),
    ...agentSuggestions.filter(({ goesByWhatIsSelected }) => !goesByWhatIsSelected),
  ];
  let isRepeated = (rules: RuleInIds[], before: Pick<ConditionalFormatSuggestion, 'rules'>[]) =>
    isAlreadyAdded(rules) ||
    [...pageSuggestions, ...before].some(
      (suggestion) => areSameRulesIgnoringFormat(originalRulesOf(suggestion.rules), originalRulesOf(rules)),
    );
  let [firstOfAgent, ...otherOfAgent] = agentSuggestionsInOrder.flatMap(
    ({ rules, matched }, index, list) =>
      isRepeated(rules, list.slice(0, index)) ? [] : [shownSuggestionFor(rules, matched)],
  );
  let editedIndex = conditionalFormats.findIndex((format) => format.conditionalFormatId === editor?.conditionalFormatId);
  let addedCount =
    previewed === null || given === null ? 0 : previewed.asIf.filter(({ inPlaceOf: rule }) => rule === null).length;
  let shownWithMatches = (rules: RuleInIds[], isFromAgent: boolean): ShownRulesWithEach => {
    let matchAt = (index: number) =>
      given === null || !isPreviewCurrent ? null : (matches[editor === null ? index : editedIndex] ?? null);
    return {
      ...asSuggestion(
        rules,
        editor === null ? sumMatches(rules.map((rule, index) => matchAt(index))) : matchAt(0),
        isFromAgent,
      ),
      each: rules.map((rule, index) => describeRule(reads, sheetId, rule, matchAt(index))),
    };
  };
  let readAtOnce = isOnlyWords && !isAskingAgentForRules(pane) ? (inWords?.read?.rules ?? null) : null;
  return {
    ...pane,
    forSelection,
    ofAgentForSelection: {
      written: rulesOfAgent,
      ofEach: agentMatches,
      listed: agentListed,
    },
    inWords,
    editor,
    tried,
    previewed,
    shown: {
      about:
        forSelection === null || editor !== null
          ? null
          : {
              cells: areasToA1AsStored(areasOfRuleRanges(reads, sheetId, [forSelection.about]), ownRowOrderOfSheet(reads, sheetId)),
              nameOfColumn: columnNameOfAbout(forSelection),
            },
      suggestions:
        editor !== null
          ? []
          : [
              ...(firstOfAgent === undefined ? [] : [firstOfAgent]),
              ...pageSuggestions.map(
                (suggestion) =>
                  shownBefore.find(({ rules }) => rules === suggestion.rules) ??
                  asSuggestion(suggestion.rules, suggestion.matches, false),
              ),
              ...otherOfAgent,
            ],
      offer: pane.offer === null ? null : shownWithMatches(pane.offer, true),
      readAtOnce: readAtOnce === null ? null : shownWithMatches(readAtOnce, false),
      rules: keepsShownRules
        ? pane.shown.rules
        : conditionalFormats.map(
            ({ conditionalFormatId, liveRanges, effect }, index) => ({
              conditionalFormatId,
              toSay: describeRule(
                reads,
                sheetId,
                {
                  ranges: liveRanges,
                  effect,
                },
                matches[index + addedCount] ?? null,
              ),
            }),
          ),
      notWorkedOut: reads.formatsGivenIn(sheetId).notWorkedOut,
      editor:
        editor === null || editedRule === null
          ? null
          : {
              conditionalFormatId: editor.conditionalFormatId,
              ...conditionalFormatEditorView(
                reads,
                sheetId,
                editor.typed?.rule ?? editor.typed?.ruleWithBox ?? ruleWithTestBeingAdded(editedRule, editor.testBeingAdded),
                {
                  ...editor,
                  testThatWaits: editor.testBeingAdded?.condition === null ? editor.testBeingAdded.tested : null,
                },
                matches[editedIndex + addedCount] ?? null,
              ),
            },
    },
  };
}
export function dropSettledRefusals(pane: ConditionalFormatsPane | null, reads: WorkbookReads): ConditionalFormatsPane | null {
  let { editor = null }: Partial<ConditionalFormatsPane> = pane ?? {};
  let { refused = [] }: Partial<RuleEditorState> = editor ?? {};
  let savedRule = pane === null || editor === null ? null : conditionalFormatRuleById(reads, pane.sheetId, editor.conditionalFormatId);
  if (pane === null || editor === null || savedRule === null || refused.length === 0) return pane;
  let rule = ruleWithTestBeingAdded(savedRule, editor.testBeingAdded);
  let stillRefused = refused.filter(({ field, over }) => {
    let fieldValue = conditionalFormatFieldValue(rule, field);
    return fieldValue !== null && isSameRulesJson(fieldValue, conditionalFormatFieldValue(over, field));
  });
  return stillRefused.length === refused.length
    ? pane
    : {
        ...pane,
        editor: {
          ...editor,
          refused: stillRefused,
        },
      };
}
export function settleConditionalFormatsPane(
  stateBefore: PageState,
  afterEvent: PageTransition,
  { reads, refusalOfEveryEdit }: PaneSettling,
): PageTransition {
  let [paneBefore, paneAfter]: [ConditionalFormatsPane | null, ConditionalFormatsPane | null] = [
    conditionalRulesOfPane(stateBefore),
    conditionalRulesOfPane(afterEvent.state),
  ];
  if (paneBefore === null && paneAfter === null) return afterEvent;
  let { state } = afterEvent;
  let isSameSheet = paneAfter?.sheetId === state.sheetId;
  let paneOnSheet: ConditionalFormatsPane | null =
    paneAfter === null || isSameSheet
      ? paneAfter
      : {
          ...paneAfter,
          sheetId: state.sheetId,
          openedAtChangeCount: state.workbookChangeCount,
          isAskedForRules: false,
          forSelection: null,
          fromAgent: {},
          ofAgentForSelection: null,
          agent:
            paneAfter.agent.kind === 'isNotToBeHad'
              ? paneAfter.agent
              : {
                  kind: 'isIdle',
                },
          offer: null,
          pointedAt: null,
          inWords: null,
          editor: null,
          tried: [],
          previewed: null,
          shown: NOTHING_SHOWN_IN_RULES_PANE,
        };
  let isEditedRuleGone =
    paneOnSheet !== null &&
    paneOnSheet.editor !== null &&
    conditionalFormatRuleById(reads, paneOnSheet.sheetId, paneOnSheet.editor.conditionalFormatId) === null;
  let paneWithEditor =
    paneOnSheet !== null && isEditedRuleGone
      ? {
          ...paneOnSheet,
          editor: null,
          offer: null,
        }
      : paneOnSheet;
  let pane = dropSettledRefusals(paneWithEditor, reads);
  const editorBefore = paneBefore?.editor ?? null;
  const isEditorLeft = editorBefore !== null && pane?.editor?.conditionalFormatId !== editorBefore.conditionalFormatId;
  let typedRuleLeft = isEditorLeft ? (editorBefore.typed?.rule ?? null) : null;
  let ruleLeft =
    paneBefore === null || editorBefore === null ? null : conditionalFormatRuleById(reads, paneBefore.sheetId, editorBefore.conditionalFormatId);
  let saveLeftTyping =
    paneBefore === null || editorBefore === null || typedRuleLeft === null || ruleLeft === null || refusalOfEveryEdit !== null
      ? null
      : conditionalFormatChangeEffect(paneBefore.sheetId, editorBefore.conditionalFormatId, ruleLeft, typedRuleLeft);
  let [wasSelecting, isSelecting] = [stateBefore.dragging?.kind === 'selecting', state.dragging?.kind === 'selecting'];
  let isSelectionSame =
    paneBefore !== null &&
    isSameSheet &&
    (wasSelecting ? isSelecting : isSameSelection(stateBefore, state) && stateBefore.otherRanges === state.otherRanges) &&
    !isEditorLeft;
  let isWorkbookUnchanged =
    stateBefore.workbookChangeCount === state.workbookChangeCount && stateBefore.formulasWorkedOutCount === state.formulasWorkedOutCount;
  let agentAsked = paneBefore?.agent.kind === 'isAsked' ? paneBefore.agent : null;
  let isAnswerMoot =
    agentAsked !== null && pane?.agent === agentAsked && (agentAsked.about === 'change' ? isEditorLeft : pane.editor !== null);
  let isMenuToCard = paneBefore?.drawnAs === 'menu' && paneBefore.wordsOfMenu !== null && pane?.drawnAs === 'card';
  let shouldStopAsking = agentAsked !== null && (pane === null || !isSameSheet || isAnswerMoot || isMenuToCard);
  let isFailureStale =
    pane?.agent.kind === 'hasFailed' &&
    pane.agent === paneBefore?.agent &&
    (!isSelectionSame || pane.editor?.conditionalFormatId !== paneBefore.editor?.conditionalFormatId);
  let areRulesAdded = afterEvent.effects.some(
    (effect) => effect.kind === 'queueEdit' && effect.edit.kind === 'addConditionalFormats',
  );
  let isKeptAskMoot = areRulesAdded && isPlainRulesMenu(paneBefore) && (state.rulesOfAgentKept?.stillAsked ?? null) !== null;
  let paneSettled: ConditionalFormatsPane | null =
    pane !== null && (isAnswerMoot || isFailureStale || isKeptAskMoot)
      ? {
          ...pane,
          agent: {
            kind: 'isIdle',
          },
        }
      : pane;
  let paneUnpointed =
    paneSettled !== null && paneSettled.pointedAt !== null && !isSelectionSame
      ? {
          ...paneSettled,
          pointedAt: null,
        }
      : paneSettled;
  let isUnchanged = paneUnpointed === paneBefore && isSelectionSame && isWorkbookUnchanged;
  let isPaneClosedByAdding = paneAfter === null && areRulesAdded;
  let kept: KeptRulesOfAgent | null =
    pane !== null || paneBefore === null || isPaneClosedByAdding
      ? null
      : isPlainRulesMenu(paneBefore)
        ? state.rulesOfAgentKept
        : rulesOfAgentToKeep(state, paneBefore);
  let isKeptStillAsked = (kept?.stillAsked ?? null) !== null;
  let stateWithNotice: PageState =
    (paneBefore?.offer ?? null) !== null &&
    (paneAfter === null || paneAfter.offer !== null) &&
    (pane?.offer ?? null) === null &&
    !isPaneClosedByAdding &&
    state.lastDone === stateBefore.lastDone
      ? {
          ...state,
          lastDone: {
            what: 'offerDiscarded',
          },
        }
      : state;
  let stateWithChange =
    saveLeftTyping === null
      ? stateWithNotice
      : {
          ...stateWithNotice,
          changesAskedFor: stateWithNotice.changesAskedFor + 1,
        };
  let refreshed =
    paneUnpointed === null || isUnchanged
      ? null
      : refreshConditionalFormatsPane(stateWithChange, reads, paneUnpointed, isSelectionSame, isWorkbookUnchanged);
  let isMoreAskMoot =
    refreshed?.agent.kind === 'isAsked' &&
    refreshed.agent.about === 'moreSuggestions' &&
    (refreshed.forSelection === null || !isAgentAnswerForCells(reads, refreshed.sheetId, refreshed.agent, refreshed.forSelection));
  let paneDone: ConditionalFormatsPane | null =
    refreshed !== null && isMoreAskMoot
      ? {
          ...refreshed,
          agent: {
            kind: 'isIdle',
          },
        }
      : refreshed;
  let settled: PageTransition = {
    state:
      paneDone === null
        ? paneUnpointed === null && paneBefore !== null
          ? {
              ...stateWithChange,
              rulesOfAgentKept: kept,
            }
          : stateWithChange
        : withConditionalFormatsPane(stateWithChange, paneDone),
    effects: [
      ...((shouldStopAsking && !isKeptStillAsked) || isMoreAskMoot || isKeptAskMoot
        ? [
            {
              kind: 'stopAskingAgentAboutConditionalFormats',
            } satisfies PageEffect,
          ]
        : []),
      ...afterEvent.effects,
      ...(saveLeftTyping === null ? [] : [saveLeftTyping]),
      ...(pane !== null && pane.drawnAs !== 'menu' && (paneBefore?.drawnAs ?? 'menu') === 'menu'
        ? [
            {
              kind: 'checkAgentForConditionalFormats',
            } satisfies PageEffect,
          ]
        : []),
    ],
  };
  let paneNow: ConditionalFormatsPane | null = conditionalRulesOfPane(settled.state);
  if (
    (paneBefore !== null && (!isPlainRulesMenu(paneBefore) || areRulesAdded)) ||
    paneNow?.drawnAs === 'menu' ||
    (paneNow?.drawnAs === 'pane' && paneNow.shown.rules.length > 0) ||
    (paneNow !== null && isCardFarFromSelection(paneNow))
  )
    return settled;
  let withMoreAsked = askAgentForMoreSuggestions(settled.state, reads);
  return {
    ...withMoreAsked,
    effects: [...settled.effects, ...withMoreAsked.effects],
  };
}
export function followContextBarRulesCard(stateBefore: PageState, afterEvent: PageTransition, settleWith: PaneSettling): PageTransition {
  let { state } = afterEvent;
  let isCardAsked = state.contextBarMenu === 'conditionalFormatting';
  let drawnAs = conditionalRulesOfPane(state)?.drawnAs;
  let isMenuGone = drawnAs === 'menu' && (state.menu?.holds !== 'all' || state.menu.at !== stateBefore.menu?.at);
  if (isCardAsked === (drawnAs === 'card') && !isMenuGone) return afterEvent;
  if (isCardAsked && !isMenuGone)
    return {
      ...afterEvent,
      state: {
        ...state,
        contextBarMenu: null,
      },
    };
  let settled = settleConditionalFormatsPane(state, withNoEffects(closeSidePane(state)), settleWith);
  return {
    state:
      state.lastDone === stateBefore.lastDone
        ? settled.state
        : {
            ...settled.state,
            lastDone: state.lastDone,
          },
    effects: [...afterEvent.effects, ...settled.effects],
  };
}
export function hasRulesPaneWorkInProgress(state: PageState): boolean {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  return pane !== null && ((pane.editor?.typed ?? null) !== null || isAgentOfferPendingOrAsked(pane));
}
export function hasRulesPaneRefusedRules(state: PageState): boolean {
  return (conditionalRulesOfPane(state)?.editor?.refused ?? []).length > 0;
}
export function conditionalFormatsGivenNow(state: PageState, reads: WorkbookReads): FormatsGiven {
  let [pane, { sheetId }]: [ConditionalFormatsPane | null, PageState] = [conditionalRulesOfPane(state), state];
  return (pane !== null && pane.sheetId === sheetId ? pane.previewed?.gives : null) ?? reads.formatsGivenIn(sheetId);
}
export function areasOfRuleBeingEdited(state: PageState, reads: WorkbookReads): CellArea[] {
  let [pane, { sheetId }]: [ConditionalFormatsPane | null, PageState] = [conditionalRulesOfPane(state), state];
  if (pane === null || pane.editor === null || pane.sheetId !== sheetId) return [];
  let rule = pane.editor.typed?.rule ?? conditionalFormatRuleById(reads, sheetId, pane.editor.conditionalFormatId);
  return rule === null ? [] : areasOfRuleRanges(reads, sheetId, rule.ranges);
}
export const ACTIONS_IN_ANY_MENU = new Set<RulesPaneAction['kind']>(['keepOffer', 'discardOffer', 'stepBack', 'previewRested']);
export const ACTIONS_IN_PLAIN_MENU = new Set<RulesPaneAction['kind']>(['pointAtSuggestion', 'takeSuggestion', 'startRule', 'showInPane']);
export const isActionForMenu = ({ wordsOfMenu }: Pick<ConditionalFormatsPane, 'wordsOfMenu'>, { kind }: Pick<RulesPaneAction, 'kind'>): boolean =>
  ACTIONS_IN_ANY_MENU.has(kind) || (wordsOfMenu === null && ACTIONS_IN_PLAIN_MENU.has(kind));
export const isPreviewBehind = ({ tried, previewed }: Pick<ConditionalFormatsPane, 'tried' | 'previewed'>): boolean => tried.length > 0 && previewed?.asIf !== tried;
