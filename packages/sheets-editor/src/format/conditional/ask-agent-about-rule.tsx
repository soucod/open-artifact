import { AgentMark } from '../../kit/agent-mark.tsx';
import type { SheetController } from '../../state/controller.ts';
import type { ConditionalFormatsOfPane, ListedSheet, PageView } from '../../view/page-view.ts';
import type { RuleDescription } from '../../messages/conditional-format.ts';
import type { ShownRule } from './pane-state.ts';
import * as React from 'react';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { cleanAskWords } from '../../agent/chat-with-agent.ts';
import { CONDITIONAL_FORMATTING_PRESS } from './pane-state.ts';
import { cardRowFrameProps, CARD_ROW_HOVER_CLASSES } from '../../ui/card-rows.tsx';
import { agentRowClassProps, AgentRowContent } from '../../agent/agent-rows.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import { isNonNullObject } from '../../utils/objects.ts';
/** Which rule of the open sheet's list a rule is, counting only the rules that can be used. */
export interface RuleNumber {
  ruleNumber: number;
  ruleCount: number;
}
/** What the page needs of its store to take rules to the chat. */
type StoreForRules = Pick<SheetController, 'isEventUnfinished' | 'getView' | 'dispatch'>;
/** The part of the chat with the agent that rules are taken to. */
export interface ChatForRules {
  openAboutRule(label: string, rule: RuleNumber & { sheetNumber: number }): Promise<boolean>;
  openWithWhatWasPressed(
    label: string,
    selectionByAddress: NonNullable<PageView['selectionByAddress']>,
    pressed: string,
    basePayload: { request: string },
  ): Promise<boolean>;
}
/** Whether the words of an ask that failed can be taken to the chat instead. */
export interface AskForChat {
  areWordsAsAsked: boolean;
  isChatToBeHad: boolean;
}
interface AskAgentAboutRuleSectionProps {
  rule: RuleNumber;
  onAskAgent: (rule: RuleNumber) => Promise<boolean>;
}
export function sheetNumberOfOpenSheet(sheets: Pick<ListedSheet, 'holdsOpenEntry' | 'isShown'>[]): number {
  let openIndex = sheets.findIndex(({ holdsOpenEntry }) => holdsOpenEntry);
  return (openIndex === -1 ? sheets.findIndex(({ isShown }) => isShown) : openIndex) + 1;
}
export function ruleNumberOfConditionalFormat(rules: ShownRule[], conditionalFormatId: string): RuleNumber | null {
  let usableRules = rules.filter(({ toSay }) => isRuleUsable(toSay));
  let index = usableRules.findIndex((rule) => rule.conditionalFormatId === conditionalFormatId);
  return index === -1
    ? null
    : {
        ruleNumber: index + 1,
        ruleCount: usableRules.length,
      };
}
export function askAgentAboutRule(store: StoreForRules, chat: Pick<ChatForRules, 'openAboutRule'>, rule: RuleNumber): Promise<boolean> {
  if (store.isEventUnfinished() || store.getView().hasUnsavedEdits) return Promise.resolve(false);
  let selectedPlacedView = () =>
    store.getView().grid.placedViews.find(({ isSelected }) => isSelected);
  let placedView = selectedPlacedView();
  if (placedView !== undefined)
    store.dispatch({
      kind: 'placedViewActedOn',
      placementId: placedView.placementId,
      act: {
        kind: 'leave',
        isForCells: false,
      },
    });
  if (selectedPlacedView() !== undefined) return Promise.resolve(false);
  return chat.openAboutRule(CONDITIONAL_FORMATTING_WORDS.ruleAttached(), {
    ...rule,
    sheetNumber: sheetNumberOfOpenSheet(store.getView().listedSheets),
  });
}
export function askAgentForRulesInChat(
  store: StoreForRules,
  chat: Pick<ChatForRules, 'openWithWhatWasPressed'>,
  words: string,
): Promise<boolean> {
  let selectionByAddress = store.getView().selectionByAddress;
  let request = cleanAskWords(words);
  if (store.isEventUnfinished() || selectionByAddress === null || request === '') return Promise.resolve(false);
  return chat.openWithWhatWasPressed(cleanAskWords(request.slice(0, MOST_PRESSED_WORDS_CHARS)), selectionByAddress, CONDITIONAL_FORMATTING_PRESS, {
    request,
  });
}
export function AskAgentAboutRuleSection({ rule, onAskAgent }: AskAgentAboutRuleSectionProps) {
  let ruleKey = `${rule.ruleNumber}/${rule.ruleCount}`;
  let [addedRuleKey, setAddedRuleKey] = React.useState<string | null>(null);
  if (addedRuleKey !== null && addedRuleKey !== ruleKey) setAddedRuleKey(null);
  return <section className="flex min-w-0 shrink-0 flex-col border-t border-alpha-2 py-1.5"><div className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><button type="button" className={agentRowClassProps.className} onClick={() => {
            onAskAgent(rule).then((isAdded) => setAddedRuleKey((keyBefore) => (isAdded ? ruleKey : keyBefore)));
          }}><AgentRowContent icon={<AgentMark size={14} />}>{CONDITIONAL_FORMATTING_WORDS.askAgentForEdits()}</AgentRowContent></button></div><LiveAnnouncer words={addedRuleKey === null ? null : CONDITIONAL_FORMATTING_WORDS.ruleAddedToMessage()} /></section>;
}
export const isGoneReference = (reference: unknown): boolean => isNonNullObject(reference) && reference.kind === 'gone';
export const isRuleUsable = ({ cells, does }: Pick<RuleDescription, 'cells' | 'does'>): boolean =>
  cells !== '' &&
  (does.kind === 'colorScale' ||
    does.tests.every(
      ({ column, condition }) =>
        !isGoneReference(column) &&
        Object.values(condition).every((part) => !isNonNullObject(part) || !isGoneReference(part.column)),
    ));
export const isAskTakenToChat = (
  { agent, isAskBeyondRules }: Pick<ConditionalFormatsOfPane, 'agent' | 'isAskBeyondRules'>,
  offer: AskForChat,
): boolean =>
  agent === 'hasFailed' && isAskBeyondRules && offer.areWordsAsAsked && offer.isChatToBeHad;
export const MOST_PRESSED_WORDS_CHARS = 60;
