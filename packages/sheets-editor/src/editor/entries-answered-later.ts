import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { layoutOfView, findSheetById } from '../grid/layout.ts';
import { textRoomInWidth } from '../grid/cell-metrics.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { shownCellText } from '../format/shown-text.ts';
import { unansweredEntryOf } from './unanswered-entries.ts';
import { isOptionText } from '../chips/dropdown-options.ts';
import { isEffectAnEdit } from '../state/edit-refusals.ts';
import { activeAnchorCell, isSameCell, areaOfPosition } from '../selection/model.ts';
import { sheetPrefixForFormula } from '../formulas/references.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { isOfferEmptyWithoutAgent, formulaReadForOffer } from '../formulas/from-words/offer.ts';
import { formulaReadsAsWords } from '../formulas/word-tokens.ts';
import { keepsAgentsFormula } from './commit-entry.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { canAskAgentForFormat } from '../format/custom-number-format.ts';
import type { Edit } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { QueuedEvent, ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageEffect, PageTransition, QueueEditEffect } from '../state/transitions.ts';
import type { EditAnswered, PageContext, PageEvent } from '../state/event-reducer.ts';
/** What an event did to the page: the event (none for a change from outside), the state before it, what it made, and the cells read. */
export interface ChangeOfPage {
  event: PageEvent | null;
  before: PageState;
  made: PageTransition;
  reads: WorkbookReads;
}
/** The acts around asking the agent for a formula, a fix or a number format, as they are counted. */
export type AgentAskAct =
  | 'words_saved_no_formula'
  | 'words_saved_waved_off'
  | 'words_saved_offer_up'
  | 'words_saved_no_agent'
  | 'words_saved_no_offer'
  | 'fix_one_kept'
  | 'formula_of_agent_kept'
  | 'formula_of_page_taken'
  | 'formula_ask_stopped'
  | 'formula_of_agent_shown'
  | 'formula_ask_failed'
  | 'formula_ask_no_formula'
  | 'formula_of_agent_left'
  | 'formula_offer_shown'
  | 'refused_none_written'
  | 'fix_one_discarded'
  | 'format_ask_stopped'
  | 'format_of_agent_shown'
  | 'format_ask_no_format'
  | 'format_ask_failed'
  | 'format_of_agent_kept'
  | 'format_of_agent_left'
  | 'format_offer_shown'
  | 'ask_number_format'
  | 'ask_fix_one'
  | 'ask_formula';
/** An act told by who did it, once its edit is queued, or once the agent answers the ask it made. */
export type AgentAskActSeen =
  | { act: AgentAskAct; by: 'person' | 'page' }
  | { act: AgentAskAct; onceQueued: Edit }
  | { act: AgentAskAct; onceAnswered: number };
/** An act told now, with who did it. */
export interface AgentAskActTold {
  act: AgentAskAct;
  from: string;
}
export function doesEntryFitOneLine(state: PageState, reads: ReadsWithTextMeasurer, cellId: CellId, text: string): boolean {
  let { alignment, font } = reads.formatOf(cellId);
  if (alignment.wrap !== true) return true;
  let position = reads.positionOfCell(cellId);
  if (position === null || isFormulaText(text)) return false;
  let columnWidth = layoutOfView(state, reads).columnEdges.sizeOf(position.columnIndex);
  let roomForText = textRoomInWidth(columnWidth);
  let shownCell = reads.cellOnShowIn(cellId);
  let shownTexts = cellValueOf(shownCell)?.kind === 'text' ? [shownCellText(shownCell, 0, 'point').text] : [];
  return reads
    .lineCountsOfWrappedTexts(
      [text, ...shownTexts].map(
        (lineText) => ({
          text: lineText,
          font,
          widthInPixels: roomForText,
        }),
      ),
    )
    .every((lineCount) => lineCount === 1);
}
export function canEntryBeAnsweredLater(
  state: PageState,
  { reads, areEditsAnsweredLater }: Pick<PageContext, 'reads' | 'areEditsAnsweredLater'>,
  { edit, editsBefore, editsThatGoAlong, ifQueued }: QueueEditEffect,
): boolean {
  if (!areEditsAnsweredLater || edit.kind !== 'enter') return false;
  let { cellId, text } = unansweredEntryOf(edit);
  let dropdown = reads.dropdownOf(cellId);
  return (
    text.length <= MAX_TEXT_ANSWERED_LATER &&
    (dropdown === null || text === '' || isOptionText(dropdown, text)) &&
    ifQueued.thenLine === undefined &&
    editsBefore === undefined &&
    (editsThatGoAlong === undefined || ifQueued.formatsToCome !== undefined) &&
    doesEntryFitOneLine(state, reads, cellId, text)
  );
}
export function doesEntryEndAtOnce(event: QueuedEvent, stateBefore: PageState, { state, effects }: PageTransition, reads: WorkbookReads): boolean {
  if (
    !effects.every(
      (effect) =>
        effect.kind === 'queueEdit' ? effect.ifQueued.endsEntryAtOnce === true : !isEffectAnEdit(effect) && !EFFECTS_THAT_KEEP_ENTRY.has(effect.kind),
    )
  )
    return false;
  if (state === stateBefore) return true;
  if (state.mode.kind === 'navigating') return stateBefore.mode.kind === 'editing' || isMoveOutEvent(event);
  if (stateBefore.mode.kind === 'editing') return true;
  if (state.mode.isTypedOverCell === true) return true;
  let anchorCell = activeAnchorCell(state, reads);
  return !state.entriesUnanswered.some(({ cellId }) => isSameCell(cellId, anchorCell));
}
export function noticeEntryNotKept(state: PageState, reads: WorkbookReads, cellId: CellId): PageState {
  let position = reads.positionOfCell(cellId);
  if (position === null)
    return {
      ...state,
      lastDone: null,
      notice: {
        kind: 'entryDroppedByRemoval',
      },
    };
  let otherSheet = cellId.sheetId === state.sheetId ? undefined : findSheetById(reads, cellId.sheetId);
  let sheetPrefix = otherSheet === undefined ? '' : sheetPrefixForFormula(otherSheet.name);
  let cellsNotKeptBefore = state.notice?.kind === 'entriesNotKept' ? state.notice.cells : [];
  let cellsNotKept = [
    ...new Set<string>([...cellsNotKeptBefore, sheetPrefix + areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(reads, cellId.sheetId))]),
  ];
  let { leftByCaret } = state;
  let isLeftAtThisEntry = leftByCaret?.what === 'entry' && isSameCell(leftByCaret.cellId, cellId);
  return {
    ...state,
    lastDone: null,
    leftByCaret: isLeftAtThisEntry ? null : leftByCaret,
    notice: {
      kind: 'entriesNotKept',
      cells: cellsNotKept,
    },
  };
}
export function answerFirstEntry(state: PageState, reads: WorkbookReads, { outcome }: Pick<EditAnswered, 'outcome'>): PageState {
  let [firstEntry, ...entriesLeft] = state.entriesUnanswered;
  if (firstEntry === undefined) return state;
  let nextState = {
    ...state,
    entriesUnanswered: entriesLeft,
  };
  return outcome.kind === 'refused' ? noticeEntryNotKept(nextState, reads, firstEntry.cellId) : nextState;
}
export function updateEntryEndedUnasked(stateBefore: PageState, stateAfter: PageState, { kind }: Pick<PageEvent, 'kind'>): PageState {
  let isLossNew =
    stateAfter.newsOfLoss !== null && stateAfter.newsOfLoss !== stateBefore.newsOfLoss && stateAfter.newsOfLoss.kind !== 'editsDropped';
  let isEndedUnasked =
    stateAfter.mode.kind !== 'editing' &&
    (stateBefore.mode.kind === 'editing' ? EVENTS_NOT_ASKED_BY_PERSON.has(kind) || isLossNew : stateAfter.isEntryEndedUnasked);
  return isEndedUnasked === stateAfter.isEntryEndedUnasked
    ? stateAfter
    : {
        ...stateAfter,
        isEntryEndedUnasked: isEndedUnasked,
      };
}
export function isAskedByPerson({ event, before, made }: Pick<ChangeOfPage, 'event' | 'before' | 'made'>): boolean {
  if (event === null || isEventNotAskedByPerson(event.kind)) return false;
  return !(before.mode.kind === 'editing' && made.state.mode.kind !== 'editing' && made.state.isEntryEndedUnasked);
}
export function actOfWordsSaved({ formulaFromWords: { stage, isWavedOff, agent } }: Pick<PageState, 'formulaFromWords'>): AgentAskAct {
  if (stage?.kind === 'cameToNothing') return 'words_saved_no_formula';
  if (isWavedOff) return 'words_saved_waved_off';
  if (stage?.kind === 'offered' && !isOfferEmptyWithoutAgent(stage)) return 'words_saved_offer_up';
  return agent === 'unavailable' || agent === 'notToBeHad' ? 'words_saved_no_agent' : 'words_saved_no_offer';
}
export function textOfEnterEdit(edit: Edit): string | null {
  if (edit.kind === 'enterInCells') return edit.text;
  return edit.kind === 'enter' && edit.entry.kind === 'text' ? edit.entry.text : null;
}
export function actsOfFormulaEntered({ before, made, reads }: ChangeOfPage): AgentAskActSeen[] {
  if (before.mode.kind !== 'editing') return [];
  let { stage } = before.formulaFromWords;
  for (let effect of made.effects) {
    if (effect.kind !== 'queueEdit' || effect.ifQueued.isSaveOfOpenEntry === true) continue;
    let { edit, ifQueued } = effect;
    let text = textOfEnterEdit(edit);
    if (text === null || !text.startsWith('=')) continue;
    if (ifQueued.isKeepOfAgentsFix === true)
      return [
        {
          act: 'fix_one_kept',
          onceQueued: edit,
        },
      ];
    if (ifQueued.isKeepOfAgentsFormula === true)
      return [
        {
          act: 'formula_of_agent_kept',
          onceQueued: edit,
        },
      ];
    if (stage?.kind === 'offered' && (text === formulaReadForOffer(stage) || text === stage.readOtherwise?.formula))
      return [
        {
          act: 'formula_of_page_taken',
          onceQueued: edit,
        },
      ];
    let sheetNames = reads.listSheets().map(({ name }) => name);
    return formulaReadsAsWords(text, sheetNames, reads.decimalSign)
      ? [
          {
            act: actOfWordsSaved(before),
            onceQueued: edit,
          },
        ]
      : [];
  }
  return [];
}
export function actsOfFormulaAsk(change: ChangeOfPage): AgentAskActSeen[] {
  let { event, before, made } = change;
  let stageBefore = before.formulaFromWords.stage;
  let { stage } = made.state.formulaFromWords;
  if (stageBefore?.kind !== 'asked' || stageBefore.isFix === true) return [];
  if (event?.kind !== 'agentRepliedWithAFormula')
    return isAskedByPerson(change) && stopsAskingAgentForFormula(made) ? actsByPerson('formula_ask_stopped') : [];
  if (stage?.kind === 'proposed') return actsByPage('formula_of_agent_shown');
  if (stage?.kind === 'offered' && stage.hasCallFailed) return actsByPage('formula_ask_failed');
  if (stage?.kind !== 'cameToNothing') return [];
  return actsByPage(stage.why === 'notAvailable' ? 'formula_ask_failed' : 'formula_ask_no_formula');
}
export function isFormulaOfAgentLeft(change: ChangeOfPage): boolean {
  let { before, made } = change;
  let stageBefore = before.formulaFromWords.stage;
  let { mode, formulaFromWords } = made.state;
  return (
    isAskedByPerson(change) &&
    stageBefore?.kind === 'proposed' &&
    stageBefore.isFix !== true &&
    formulaFromWords.stage?.kind !== 'proposed' &&
    formulaFromWords.stage?.kind !== 'cameToNothing' &&
    !keepsAgentsFormula(made) &&
    (mode.kind !== 'editing' || mode.text === stageBefore.words)
  );
}
export function isAnswerWithoutFormula(answer: unknown): boolean {
  let formula = isNonNullObject(answer) ? answer.formula : null;
  return typeof formula !== 'string' || !formula.startsWith('=');
}
export function actsOfFixOne(change: ChangeOfPage): AgentAskActSeen[] {
  let { event, before, made } = change;
  let stageBefore = before.formulaFromWords.stage;
  let { mode, formulaFromWords } = made.state;
  if (stageBefore?.kind === 'asked' && stageBefore.isFix === true) {
    let fixThatCameToNothing = formulaFromWords.fixThatCameToNothing;
    return event?.kind === 'agentRepliedWithAFormula' &&
      event.reply.kind === 'answered' &&
      isAnswerWithoutFormula(event.reply.answer) &&
      fixThatCameToNothing !== before.formulaFromWords.fixThatCameToNothing &&
      fixThatCameToNothing?.why === 'noFormula'
      ? actsByPage('refused_none_written')
      : [];
  }
  if (stageBefore?.kind !== 'proposed' || stageBefore.isFix !== true) return [];
  return isAskedByPerson(change) && mode.kind !== 'editing' && !keepsAgentsFormula(made) ? actsByPerson('fix_one_discarded') : [];
}
export function actsOfFormatAsk(change: ChangeOfPage): AgentAskActSeen[] {
  let { event, before, made } = change;
  let agentBefore = before.customNumberFormat?.agent ?? null;
  let agent = made.state.customNumberFormat?.agent ?? null;
  if (agentBefore?.kind === 'asked') {
    if (event?.kind !== 'agentRepliedWithANumberFormat')
      return isAskedByPerson(change) && stopsAskingAgentForFormula(made) ? actsByPerson('format_ask_stopped') : [];
    if (agent?.kind === 'wrote') return actsByPage('format_of_agent_shown');
    if (agent?.kind !== 'cameToNothing') return [];
    return actsByPage(agent.why === 'noFormat' ? 'format_ask_no_format' : 'format_ask_failed');
  }
  if (agentBefore?.kind !== 'wrote' || event === null || !isAskedByPerson(change)) return [];
  let formatEdit =
    event.kind === 'customNumberFormatEntered' ? made.effects.find((effect) => effect.kind === 'queueEdit') : undefined;
  if (formatEdit !== undefined)
    return [
      {
        act: 'format_of_agent_kept',
        onceQueued: formatEdit.edit,
      },
    ];
  return event.kind !== 'editAnswered' && agent?.kind !== 'wrote' && agent?.kind !== 'typedOn' ? actsByPerson('format_of_agent_left') : [];
}
export function createAgentAskActs(whoActs: () => string): (change: ChangeOfPage) => (AgentAskActSeen | AgentAskActTold)[] {
  let wasFormulaOfferShown = false;
  let wasFormatOfferShown = false;
  let actsAwaitingAnswer = new Map<number, AgentAskActTold>();
  let actsOfAnswer = (event: PageEvent | null): AgentAskActTold[] => {
    if (event?.kind !== 'agentRepliedWithAFormula' && event?.kind !== 'agentRepliedWithANumberFormat') return [];
    let act = actsAwaitingAnswer.get(event.askId);
    actsAwaitingAnswer.delete(event.askId);
    return act === undefined || event.reply.kind === 'notToBeHad' ? [] : [act];
  };
  return (change) => {
    let { mode, formulaFromWords, customNumberFormat } = change.made.state;
    let { stage } = formulaFromWords;
    let isFormulaOfferShown = mode.kind === 'editing' && stage?.kind === 'offered' && stage.isDrawn && !isOfferEmptyWithoutAgent(stage);
    let isFormatOfferShown = customNumberFormat?.isRefusalTold === false && canAskAgentForFormat(change.made.state);
    let offersShown = [
      ...(isFormulaOfferShown && !wasFormulaOfferShown ? actsByPage('formula_offer_shown') : []),
      ...(isFormatOfferShown && !wasFormatOfferShown ? actsByPage('format_offer_shown') : []),
    ];
    wasFormulaOfferShown = mode.kind === 'editing' && (wasFormulaOfferShown || isFormulaOfferShown);
    wasFormatOfferShown = customNumberFormat !== null && (wasFormatOfferShown || isFormatOfferShown);
    let acts = [
      ...offersShown,
      ...actsOfAgentAsked(change),
      ...actsOfFormulaAsk(change),
      ...(isFormulaOfAgentLeft(change) ? actsByPerson('formula_of_agent_left') : []),
      ...actsOfFormulaEntered(change),
      ...actsOfFixOne(change),
      ...actsOfFormatAsk(change),
    ];
    return [
      ...actsOfAnswer(change.event),
      ...acts.flatMap((act): (AgentAskActSeen | AgentAskActTold)[] => {
        if ('onceQueued' in act) return [act];
        let from = 'by' in act && act.by === 'page' ? 'page' : whoActs();
        if ('by' in act)
          return [
            {
              act: act.act,
              from,
            },
          ];
        actsAwaitingAnswer.set(act.onceAnswered, {
          act: act.act,
          from,
        });
        return [];
      }),
    ];
  };
}
export const MAX_TEXT_ANSWERED_LATER = 250;
export const ARROW_OR_TAB_KEY = /^(?:Arrow(?:Up|Down|Left|Right)|Tab)$/;
export const isMoveOutEvent = (event: QueuedEvent): boolean =>
  event.kind === 'keyPressed'
    ? !event.isModifierHeld && !event.isAltHeld && ARROW_OR_TAB_KEY.test(event.key)
    : event.kind === 'pointerPressed' || event.kind === 'pointerDragged' || event.kind === 'pointerReleased';
export const EFFECTS_THAT_KEEP_ENTRY = new Set<PageEffect['kind']>(['waitForPeople', 'workOutFormulasLeft', 'dropWhatIsHeld']);
export const EVENTS_NOT_ASKED_BY_PERSON = new Set<PageEvent['kind']>([
  'figuresOfSelectionDue',
  'waysInWaitedFor',
  'agentRepliedAboutConditionalFormats',
  'versionsLookedAtAgain',
  'cellHistoryLookedAtAgain',
  'findLookedAgain',
  'windowCaretChanged',
  'ownFiltersLookedAtAgain',
  'agentRepliedWithANumberFormat',
  'agentRepliedAboutImport',
  'agentWroteOnAboutImport',
  'importAskedByHost',
  'formulaOfAgentArrived',
  'agentsAnswerSeen',
  'agentForFormulasChecked',
  'agentRepliedWithAFormula',
  'agentRepliedWithAFix',
  'agentRepliedWhichRowsAreAskedFor',
  'tablesRead',
  'selectionsOfOthersChanged',
  'workbookChanged',
  'formulasWorkedOut',
  'textMeasuredAnew',
  'editsDropped',
  'savingChanged',
  'formulasLeftChanged',
  'causeOfErrorRead',
  'workShownLongEnough',
  'agentActivityChanged',
  'changesByAgentChanged',
  'followAsked',
  'viewShownByAgentChanged',
  'commentModeChanged',
  'commentsTold',
  'commentsPointedAt',
  'commentPicked',
  'cellsLinkedTo',
]);
export const isEventNotAskedByPerson = (kind: PageEvent['kind']): boolean => EVENTS_NOT_ASKED_BY_PERSON.has(kind);
export const actsByPerson = (act: AgentAskAct): AgentAskActSeen[] => [
  {
    act,
    by: 'person',
  },
];
export const actsByPage = (act: AgentAskAct): AgentAskActSeen[] => [
  {
    act,
    by: 'page',
  },
];
export const stopsAskingAgentForFormula = ({ effects }: Pick<PageTransition, 'effects'>): boolean =>
  effects.some(({ kind }) => kind === 'stopAskingAgentForAFormula');
export const actsOfAgentAsked = ({ made: { state, effects } }: Pick<ChangeOfPage, 'made'>): AgentAskActSeen[] =>
  effects.flatMap((effect): AgentAskActSeen[] => {
    if (effect.kind === 'askAgentForANumberFormat')
      return [
        {
          act: 'ask_number_format',
          onceAnswered: effect.askId,
        },
      ];
    if (effect.kind !== 'askAgentForAFormula') return [];
    let { stage } = state.formulaFromWords;
    return [
      {
        act: stage?.kind === 'asked' && stage.isFix === true ? 'ask_fix_one' : 'ask_formula',
        onceAnswered: effect.askId,
      },
    ];
  });
