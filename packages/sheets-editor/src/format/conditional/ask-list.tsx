import { ContextMenu } from '../../kit/context-menu.tsx';
import { AgentMark } from '../../kit/agent-mark.tsx';
import { Tooltip } from '../../kit/tooltip.tsx';
import { Icon } from '../../kit/icon.tsx';
import type { AskFieldStands } from '../../agent/agent-rows.tsx';
import type { RuleInIds } from '@open-artifact/sheets-core';
import type { RuleDescription } from '../../messages/conditional-format.ts';
import type { ConditionalFormatsOfPane, ConditionalFormatsView } from '../../view/page-view.ts';
import type { RulesPaneAction, ShownRulesWithEach, ShownSuggestion } from './pane-state.ts';
import * as React from 'react';
import {
  wordsOfRuleEntry,
  joinWithCommas,
  ruleSummary,
  addRulesLabel,
  joinWithDots,
  CONDITIONAL_FORMATTING_WORDS,
  rulesReadyHint,
  moreSuggestionsWords,
  notARuleHint,
  ruleReadingHint,
  ruleListWhat,
  ruleWhereWords,
  ruleCountBadgeLabel,
} from '../../messages/conditional-format.ts';
import { RuleSample, SeveralRulesSample } from './rule-samples.tsx';
import { WordsWithColumnNames } from '../../ui/card-rows.tsx';
import { joinMessageParts } from '../../i18n/messages.ts';
import { DrawnAndSaid, AgentWritingRow } from '../../agent/agent-rows.tsx';
import { goToChatInsteadWords, GoToChatInstead } from './ask-box.tsx';
import { isAskTakenToChat } from './ask-agent-about-rule.tsx';
import { AskOrPickList } from '../../ui/ask-list/ask-or-pick-list.tsx';
import { isoDayOfDate } from '../../chips/calendar.ts';
import { TypedSearchAnnouncer } from '../../ui/search-announcer.tsx';
import { SIDE_PANE_DEFAULT_WIDTH } from '../../ui/side-pane/side-pane.tsx';
/** What a row of the ask list does when taken: ask the agent, take the rules read at once, or act in the pane. */
export type AskListRowAction = 'ask' | 'takeRead' | RulesPaneAction;
/** What the status words of the ask list are worked out from, besides the pane. */
interface AskListStatus {
  hasFailed: boolean;
  isForChat: boolean;
  /** How many suggestions of the agent are shown. */
  countOfAgents: number;
}
interface OfferedRuleLineProps {
  rule: RuleDescription;
}
interface RuleOfferMenuItemProps {
  offer: ShownRulesWithEach;
  isUnderEnter: boolean;
  onKept: () => void;
}
interface ConditionalAskCardProps {
  pane: ConditionalFormatsView;
  onAct: (action: RulesPaneAction) => void;
  onAskedInChat: ((words: string) => Promise<boolean>) | null;
}
export function conditionalAskListHeight(rowCount: number, extraPx = 0): string {
  let height = `calc(3.625rem + ${Math.min(rowCount, MOST_ASK_LIST_ROWS)} * max(var(--ui-h-control), 1.75rem))`;
  return extraPx === 0 ? height : `min(calc(${height} + ${extraPx}px), ${conditionalAskListHeight(MOST_ASK_LIST_ROWS)})`;
}
export function askListRowAction(rowId: string, suggestions: ShownSuggestion[]): AskListRowAction | null {
  if (rowId === WRITE_RULE_ROW_ID) return 'ask';
  if (rowId === READ_AT_ONCE_ROW_ID) return 'takeRead';
  if (rowId === ANSWER_ROW_ID)
    return {
      kind: 'keepOffer',
    };
  if (isReadyRowId(rowId)) return READY_ROW_ACTIONS[rowId];
  let rules = rulesOfSuggestionRow(rowId, suggestions);
  return rules === null
    ? null
    : {
        kind: 'takeSuggestion',
        rules,
      };
}
export function suggestionRow(suggestion: ShownSuggestion, easesIn = false) {
  let { what, cells } = wordsOfRuleEntry(suggestion.toSay);
  return {
    id: suggestionRowId(suggestion),
    easesIn,
    isOfAgent: suggestion.isFromAgent,
    mark: <RuleSample rules={suggestion.toSay} isSwatch />,
    drawn: <WordsWithColumnNames words={what} />,
    atEnd: <span className="block max-w-28 truncate">{cells}</span>,
    inFull: joinWithCommas([joinMessageParts(what), cells]),
  };
}
export function OfferedRuleLine({ rule }: OfferedRuleLineProps) {
  let words = ruleSummary(rule);
  let wordsRef = React.useRef<HTMLSpanElement>(null);
  let [isTooltipOpen, setIsTooltipOpen] = React.useState(false);
  return <Tooltip content={joinMessageParts(words)} side="inline-end" sideOffset={10} collisionAvoidance={{
      fallbackAxisSide: 'none',
    }} hoverable={false} open={isTooltipOpen}><span className="flex min-h-control items-center gap-2 py-1" onPointerEnter={() => {
        let { scrollWidth = 0, clientWidth = 0 }: Partial<Pick<HTMLElement, 'scrollWidth' | 'clientWidth'>> = wordsRef.current ?? {};
        setIsTooltipOpen(scrollWidth > clientWidth);
      }} onPointerLeave={() => setIsTooltipOpen(false)}><RuleSample rules={{
            kind: 'one',
            rule,
          }} isSwatch /><span ref={wordsRef} className="min-w-0 flex-1 truncate touch:whitespace-normal"><WordsWithColumnNames words={words} /></span></span></Tooltip>;
}
export function offerRow({ toSay, each }: Pick<ShownRulesWithEach, 'toSay' | 'each'>, rowId: string = ANSWER_ROW_ID) {
  let { what, where } = wordsOfRuleEntry(toSay);
  if (toSay.kind === 'several')
    return {
      id: rowId,
      mark: <SeveralRulesSample rules={each} isSwatch />,
      drawn: <DrawnAndSaid drawn={addRulesLabel(each.length)} said={joinWithDots([addRulesLabel(each.length), ...each.map((rule) => joinMessageParts(ruleSummary(rule)))])} />,
    };
  return {
    id: rowId,
    mark: <span className="flex self-start"><RuleSample rules={toSay} isSwatch /></span>,
    laysItselfOut: true,
    drawn: <span className="flex min-w-0 flex-1 flex-col"><span className="line-clamp-2 min-w-0 wrap-anywhere"><WordsWithColumnNames words={what} /></span><span className="truncate text-footnote text-muted">{where}</span></span>,
    inFull: joinWithCommas([joinMessageParts(what), where]),
  };
}
export function RuleOfferMenuItem(props: RuleOfferMenuItemProps) {
  let { offer, isUnderEnter, onKept } = props;
  let { mark, drawn } = offerRow(offer);
  return <><ContextMenu.Item icon={<>{mark}</>} {...(isUnderEnter && {
          className: 'sheet-row-under-enter',
        })} onClick={onKept}><span className="block w-0 min-w-full whitespace-normal">{drawn}</span></ContextMenu.Item>{offer.toSay.kind === 'several' &&
        (<span aria-hidden className="flex flex-col px-md text-body text-primary">{offer.each.map(
            (rule, index) =>
              <OfferedRuleLine key={index} rule={rule} />,
          )}</span>)}</>;
}
export function moreFromAgentWords(moreFromAgent: ConditionalFormatsOfPane['moreFromAgent']): string | null {
  if (moreFromAgent === 'isLookedFor') return CONDITIONAL_FORMATTING_WORDS.agentLooksForMore();
  if (moreFromAgent === 'couldNotBeLookedFor') return CONDITIONAL_FORMATTING_WORDS.agentCouldNotLookForMore();
  return moreFromAgent === 'isNone' ? CONDITIONAL_FORMATTING_WORDS.agentFoundNothingMore() : null;
}
export function askListStatusWords(
  { agent, offer, moreFromAgent }: Pick<ConditionalFormatsView, 'agent' | 'offer' | 'moreFromAgent'>,
  { hasFailed, isForChat, countOfAgents }: AskListStatus,
): string | null {
  if (agent === 'writes') return CONDITIONAL_FORMATTING_WORDS.writingRules();
  if (offer !== null) return rulesReadyHint(offer.each.length);
  if (hasFailed) return isForChat ? goToChatInsteadWords(chatInsteadForRules()) : CONDITIONAL_FORMATTING_WORDS.rulesNotWritten();
  return moreFromAgentWords(moreFromAgent) ?? (countOfAgents > 0 ? moreSuggestionsWords(countOfAgents) : null);
}
export function foundRuleWords(rule: RuleDescription | null, isNotComposing: boolean) {
  if (rule === null) return isNotComposing && notARuleHint();
  return isNotComposing ? ruleReadingHint(rule) : joinWithCommas([joinMessageParts(ruleListWhat(rule)), ruleWhereWords(rule)]);
}
export function ConditionalAskCard({ pane, onAct, onAskedInChat }: ConditionalAskCardProps) {
  let [typed, setTyped] = React.useState('');
  let [askedWords, setAskedWords] = React.useState<string | null>(null);
  let [hasAsked, setHasAsked] = React.useState(false);
  let [pointedRowId, setPointedRowId] = React.useState<string | null>(null);
  let pointedRulesRef = React.useRef<RuleInIds[] | null>(null);
  let stands: AskFieldStands = pane.agent === 'writes' ? 'whileAgentWrites' : 'atRest';
  let hasOffer = pane.offer !== null;
  let isTyped = typed.trim() !== '';
  let readAtOnce = isTyped ? pane.readAtOnce : null;
  let restTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  React.useEffect(() => () => clearTimeout(restTimerRef.current), []);
  let readAtOnceWords = readAtOnce === null ? null : wordsOfRuleEntry(readAtOnce.toSay);
  let hasFailedForTyped = pane.agent === 'hasFailed' && askedWords === typed;
  let isForChat =
    readAtOnce === null &&
    isAskTakenToChat(pane, {
      areWordsAsAsked: askedWords === typed,
      isChatToBeHad: onAskedInChat !== null,
    });
  let suggestionsShown = hasFailedForTyped ? [] : pane.suggestions.slice(0, MAX_SUGGESTIONS_SHOWN);
  let [suggestionIdsAtOpen, setSuggestionIdsAtOpen] = React.useState(() => suggestionsShown.map(suggestionRowId));
  let [rowsAtOpen] = React.useState(() => askListRowsAtOpen(suggestionsShown.length, pane.moreFromAgent === 'isLookedFor'));
  let cardRef = React.useRef<HTMLDivElement>(null);
  let [extraHeight, setExtraHeight] = React.useState(0);
  let isAnswerShown = hasFailedForTyped || pane.offer !== null || (readAtOnceWords !== null && joinMessageParts(readAtOnceWords.what));
  React.useLayoutEffect(() => {
    let listbox = cardRef.current?.querySelector('[role="listbox"]') ?? null;
    if (isAnswerShown === false || listbox === null) return;
    let overflow = listbox.scrollHeight - listbox.clientHeight;
    if (overflow > 0) setExtraHeight((heightBefore) => heightBefore + overflow + ROWS_ADDED_WITH_MORE);
  }, [isAnswerShown]);
  let wasShownAtOpen = (suggestion: ShownSuggestion) => !suggestion.isFromAgent || isTyped || suggestionIdsAtOpen.includes(suggestionRowId(suggestion));
  if (isTyped && !suggestionsShown.every((suggestion) => suggestionIdsAtOpen.includes(suggestionRowId(suggestion))))
    setSuggestionIdsAtOpen(suggestionsShown.map(suggestionRowId));
  let isLookingForMore = pane.moreFromAgent === 'isLookedFor';
  let showsKinds = !isTyped && suggestionsShown.length === 0;
  let ruleCount = pane.rules.length;
  let firstRowId = hasOffer ? ANSWER_ROW_ID : readAtOnce !== null ? READ_AT_ONCE_ROW_ID : WRITE_RULE_ROW_ID;
  let writeRow = {
    id: WRITE_RULE_ROW_ID,
    mark: inMarkColumn(
      <AgentMark size={14} />,
    ),
    drawn: CONDITIONAL_FORMATTING_WORDS.writeRules(),
  };
  let highlightRow = askListRow(
    'highlight',
    <Icon name="TextHighlight" size="md" />,
    CONDITIONAL_FORMATTING_WORDS.addHighlightRule(),
  );
  let sections = [
    ...(pane.offer === null
      ? []
      : [
          {
            id: 'answer',
            heading: null,
            rows: [offerRow(pane.offer)],
          },
          ...(pane.offer.toSay.kind === 'several'
            ? [
                {
                  id: 'added',
                  heading: <span aria-hidden className="-mt-2 -mb-1 flex flex-col text-body font-normal text-primary">{pane.offer.each.map(
                      (rule, index) =>
                        <OfferedRuleLine key={index} rule={rule} />,
                    )}</span>,
                  rows: [],
                },
              ]
            : []),
        ]),
    ...(pane.offer !== null || readAtOnce === null
      ? []
      : [
          {
            id: 'readAtOnce',
            heading: null,
            rows: [offerRow(readAtOnce, READ_AT_ONCE_ROW_ID)],
          },
          {
            id: 'write',
            heading: null,
            rows: [writeRow],
          },
        ]),
    ...(pane.offer === null && readAtOnce === null && !isForChat && (isTyped || suggestionsShown.length > 0)
      ? [
          {
            id: 'suggested',
            heading: isTyped
              ? null
              : <span className="flex h-4 items-center">{CONDITIONAL_FORMATTING_WORDS.suggested()}</span>,
            rows: isTyped ? [writeRow] : [],
            lateRows: suggestionsShown
              .slice(0, 1)
              .filter((suggestion) => !wasShownAtOpen(suggestion))
              .map((suggestion) => suggestionRow(suggestion)),
            rowsUnderLateRows: suggestionsShown
              .filter((suggestion, index) => index > 0 || wasShownAtOpen(suggestion))
              .map((suggestion) => suggestionRow(suggestion, !wasShownAtOpen(suggestion))),
          },
        ]
      : []),
    ...(showsKinds
      ? [
          {
            id: 'kinds',
            heading: null,
            rows: [
              highlightRow,
              {
                ...askListRow(
                  'colorScale',
                  <Icon name="ColorScale" size="md" />,
                  CONDITIONAL_FORMATTING_WORDS.addColorScaleRule(),
                ),
                isOutOfUse: pane.about === null,
              },
            ],
          },
        ]
      : []),
    {
      id: 'always',
      heading: null,
      rows: [
        ...(showsKinds
          ? []
          : [
              askListRow(
                'highlight',
                <Icon name="Add" size="md" />,
                CONDITIONAL_FORMATTING_WORDS.createRule(),
              ),
            ]),
        {
          ...askListRow(
            'showRules',
            <Icon name="ConditionalFormat" size="md" />,
            CONDITIONAL_FORMATTING_WORDS.showRules(),
          ),
          ...(ruleCount > 0 && {
            atEnd: <DrawnAndSaid drawn={String(ruleCount)} said={ruleCountBadgeLabel(ruleCount)} />,
          }),
        },
      ],
    },
  ];
  let askAgent = () => {
    setAskedWords(typed);
    setHasAsked(true);
    onAct({
      kind: 'askAgent',
      words: typed,
      canChatTakeIt: onAskedInChat !== null,
    });
  };
  let askInChat = () => void onAskedInChat?.(typed);
  let stepBack = () =>
    onAct({
      kind: 'stepBack',
    });
  let askList = <AskOrPickList nameOfField={CONDITIONAL_FORMATTING_WORDS.askAgentToMakeARule()} nameOfList={CONDITIONAL_FORMATTING_WORDS.waysToAddARule()} placeholder={CONDITIONAL_FORMATTING_WORDS.askAgentToMakeARule()} text={typed} stands={stands} hasAnswer={hasOffer} isAgentAtWork={stands === 'whileAgentWrites' || isLookingForMore} said={askListStatusWords(pane, {
      hasFailed: hasFailedForTyped,
      isForChat,
      countOfAgents: isTyped ? 0 : suggestionsShown.filter(({ isFromAgent }) => isFromAgent).length,
    })} note={hasFailedForTyped
      ? (<div className="px-md py-1 text-footnote text-secondary">{isForChat
            ? <GoToChatInstead {...chatInsteadForRules()} onTaken={askInChat} />
            : CONDITIONAL_FORMATTING_WORDS.rulesNotWritten()}</div>)
      : null} sections={sections} {...(stands === 'whileAgentWrites' && {
      inPlaceOfList: (<AgentWritingRow words={{
          writes: CONDITIONAL_FORMATTING_WORDS.writingRules(),
          stop: CONDITIONAL_FORMATTING_WORDS.stop(),
        }} isAmongRowsOfList onStopped={stepBack} />),
    })} doesFirstRowAnswer={isTyped && !isForChat} foot={null} wordsOfFoot={{
      keep: CONDITIONAL_FORMATTING_WORDS.keep(),
      discard: CONDITIONAL_FORMATTING_WORDS.discard(),
      stop: CONDITIONAL_FORMATTING_WORDS.stop(),
    }} height={conditionalAskListHeight(rowsAtOpen, extraHeight)} width={CONDITIONAL_ASK_LIST_WIDTH} onTextChange={(text: string) => {
      if (hasOffer && text !== typed)
        onAct({
          kind: 'discardOffer',
        });
      setTyped(text);
      setHasAsked(false);
      onAct({
        kind: 'typeWords',
        words: text,
        today: isoDayOfDate(new Date()),
      });
      clearTimeout(restTimerRef.current);
      restTimerRef.current = setTimeout(
        () =>
          onAct({
            kind: 'restAfterWords',
            words: text,
          }),
        REST_AFTER_WORDS_MS,
      );
    }} onRowPointedAt={(rowId: string | null) => {
      setPointedRowId(rowId);
      let rules = rulesOfSuggestionRow(rowId, pane.suggestions);
      if (rules === pointedRulesRef.current) return;
      pointedRulesRef.current = rules;
      onAct({
        kind: 'pointAtSuggestion',
        rules,
      });
    }} onRowTaken={(rowId: string) => {
      let action = askListRowAction(rowId, pane.suggestions);
      if (action === 'ask') return askAgent();
      if (action === 'takeRead') {
        setAskedWords(typed);
        setHasAsked(true);
        return onAct({
          kind: 'takeReadAtOnce',
          words: typed,
          today: isoDayOfDate(new Date()),
          canChatTakeIt: onAskedInChat !== null,
        });
      }
      if (action === null) return;
      if (hasOffer && action.kind !== 'keepOffer' && action.kind !== 'startRule')
        onAct({
          kind: 'discardOffer',
        });
      return onAct(action);
    }} onEntered={isForChat ? askInChat : askAgent} onKept={() =>
      onAct({
        kind: 'keepOffer',
      })} onSteppedBack={stepBack} />;
  return <div ref={cardRef} className="contents">{askList}<TypedSearchAnnouncer typed={typed} found={(isNotComposing: boolean) => {
          let isOtherRowPointed = pointedRowId !== null && pointedRowId !== firstRowId;
          if (!isTyped || stands !== 'atRest' || hasOffer || (hasFailedForTyped && readAtOnce === null)) return false;
          if ((hasAsked && readAtOnce === null) || isOtherRowPointed) return false;
          return foundRuleWords(readAtOnce?.each[0] ?? null, isNotComposing);
        }} /></div>;
}
export const MAX_SUGGESTIONS_SHOWN = 3;
export const MOST_ASK_LIST_ROWS = MAX_SUGGESTIONS_SHOWN + 3;
export const ROWS_ADDED_WITH_MORE = 2;
export const askListRowsAtOpen = (suggestionCount: number, areAllShown: boolean): number =>
  areAllShown ? MOST_ASK_LIST_ROWS : suggestionCount === 0 ? 3 : suggestionCount + 3;
export const CONDITIONAL_ASK_LIST_WIDTH = SIDE_PANE_DEFAULT_WIDTH;
export const READY_ROW_ACTIONS = {
  highlight: {
    kind: 'startRule',
    effect: 'formatWhere',
  },
  colorScale: {
    kind: 'startRule',
    effect: 'colorScale',
  },
  showRules: {
    kind: 'showInPane',
  },
} satisfies Record<string, RulesPaneAction>;
export const isReadyRowId = (rowId: string): rowId is keyof typeof READY_ROW_ACTIONS => rowId in READY_ROW_ACTIONS;
export const WRITE_RULE_ROW_ID = 'write';
export const suggestionRowId = ({ rules }: Pick<ShownSuggestion, 'rules'>): string => JSON.stringify(rules);
export const rulesOfSuggestionRow = (rowId: string | null, suggestions: ShownSuggestion[]): RuleInIds[] | null =>
  suggestions.find((suggestion) => suggestionRowId(suggestion) === rowId)?.rules ?? null;
export const isConditionalAskActionTaken = ({ kind }: Pick<RulesPaneAction, 'kind'>): boolean =>
  kind === 'takeSuggestion' || kind === 'takeReadAtOnce' || kind === 'keepOffer' || kind === 'startRule' || kind === 'showInPane';
export const inMarkColumn = (children: React.ReactNode) =>
  <span className="flex w-5 flex-none justify-center">{children}</span>;
export const askListRow = (id: string, mark: React.ReactNode, drawn: string) => ({
  id,
  mark,
  drawn,
});
export const ANSWER_ROW_ID = 'answer';
export const READ_AT_ONCE_ROW_ID = 'readAtOnce';
export const REST_AFTER_WORDS_MS = 500;
export const chatInsteadForRules = () => ({
  whyNotHere: CONDITIONAL_FORMATTING_WORDS.rulesAloneCantDoIt(),
  goThere: CONDITIONAL_FORMATTING_WORDS.goToChatForRules(),
});
