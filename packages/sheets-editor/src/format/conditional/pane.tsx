import { Tooltip, TooltipGroup } from '../../kit/tooltip.tsx';
import { Button } from '../../kit/button.tsx';
import { Icon } from '../../kit/icon.tsx';
import type { RuleDescription } from '../../messages/conditional-format.ts';
import type { ColorPickerChoices, ConditionalFormatsView } from '../../view/page-view.ts';
import type { ActInRulesPane, RulesPaneAction, ShownRule, ShownSuggestion } from './pane-state.ts';
import type { RuleNumber } from './ask-agent-about-rule.tsx';
import type { AgentDraft, AskBoxRow, AskBoxWords, PressGuardHandlers } from './ask-box.tsx';
import * as React from 'react';
import {
  CONDITIONAL_FORMATTING_WORDS,
  rulesReadyHint,
  wordsOfRuleEntry,
  ruleSummary,
  reorderRuleLabel,
  ruleListWhat,
  ruleWhereWords,
  removeRuleLabel,
  writtenByAgentUnsavedWords,
  rulesNotAppliedReason,
  addRulesLabel,
} from '../../messages/conditional-format.ts';
import { RuleSample, SeveralRulesSample } from './rule-samples.tsx';
import { joinMessageParts } from '../../i18n/messages.ts';
import {
  CardRowTexts,
  wordsFadeUnderButtonProps,
  cardRowFrameProps,
  CARD_ROW_HOVER_CLASSES,
  cardRowButtonProps,
  cardRowEndButtonsProps,
  CardSectionHeading,
} from '../../ui/card-rows.tsx';
import { REORDER_LIFT_PROPS, useReorderRows } from '../../ui/reorder-rows.ts';
import { useAnyCoarsePointer } from '../../app/media-queries.ts';
import { useFocusAskField, agentRowClassProps, AgentRowContent } from '../../agent/agent-rows.tsx';
import { isAskTakenToChat, ruleNumberOfConditionalFormat, AskAgentAboutRuleSection } from './ask-agent-about-rule.tsx';
import { revealInSidePane, focusPaneStart, useSidePaneCaret, SidePane, PANE_START_ATTRIBUTE } from '../../ui/side-pane/side-pane.tsx';
import { NO_LIST_ANSWER_TIMES, isTooSoonAfterListAnswer, isWithinPressGuard } from '../../ui/list-under-cell.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import { ConditionalRuleEditor } from './rule-editor.tsx';
import { ContentsBox } from '../../ui/contents-box.tsx';
import { RuleAskBox } from './ask-box.tsx';
/** What the status words of the pane are worked out from, besides the pane. */
interface RulesPaneStatus {
  isForChat: boolean;
  isMakingRule: boolean;
  areSomeOfAgent: boolean;
  isTyped: boolean;
}
/** Where the caret goes once the pane is drawn again. */
type CaretTargetInRulesPane = 'startOfView' | 'firstOfAgent' | { ruleAt: number } | { handleOf: string };
interface ConditionalRuleRowProps {
  rule: ShownRule;
  index: number;
  isAlone: boolean;
  isOnTouch: boolean;
  reorder: ReturnType<typeof useReorderRows>;
  keysThatMoveSaidBy: string;
  onAct: ActInRulesPane;
  onRemoved: (index: number) => void;
}
export interface ConditionalFormattingPaneProps {
  pane: ConditionalFormatsView | null;
  timesAsked: number;
  changesAskedFor: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  whatColorPickerShows: () => ColorPickerChoices;
  onAct: ActInRulesPane;
  /** Runs `look` once the events dispatched so far are worked through. */
  lookOnceEventsAreFinished: (look: () => void) => void;
  onPressed: () => void;
  onShut: () => void;
  onAskAgent: ((rule: RuleNumber) => Promise<boolean>) | null;
  onAskedInChat: ((words: string) => Promise<boolean>) | null;
}
export function conditionalPaneStatusWords(
  { agent, offer, moreFromAgent }: Pick<ConditionalFormatsView, 'agent' | 'offer' | 'moreFromAgent'>,
  paneState: RulesPaneStatus,
): string | null {
  if (agent === 'writes') return CONDITIONAL_FORMATTING_WORDS.writingRules();
  if (offer !== null) return rulesReadyHint(offer.each.length);
  if (agent === 'hasFailed') return paneState.isForChat ? null : CONDITIONAL_FORMATTING_WORDS.rulesNotWritten();
  if (!paneState.isMakingRule) return null;
  if (moreFromAgent === 'isLookedFor') return CONDITIONAL_FORMATTING_WORDS.agentLooksForMore();
  if (moreFromAgent === 'couldNotBeLookedFor') return CONDITIONAL_FORMATTING_WORDS.moreSuggestionsFailed();
  if (moreFromAgent === 'isNone') return CONDITIONAL_FORMATTING_WORDS.agentFoundNothingMore();
  return moreFromAgent === null && paneState.areSomeOfAgent && !paneState.isTyped ? CONDITIONAL_FORMATTING_WORDS.suggestedByAgent() : null;
}
export function ruleSuggestionEntry(suggestion: ShownSuggestion): AskBoxRow {
  let { what: title, where: second } = wordsOfRuleEntry(suggestion.toSay);
  return {
    key: ruleSuggestionKey(suggestion),
    sample: <RuleSample rules={suggestion.toSay} />,
    title,
    second,
  };
}
export function ConditionalRuleRow({
  rule: { conditionalFormatId, toSay: rule },
  index,
  isAlone,
  isOnTouch,
  reorder,
  keysThatMoveSaidBy,
  onAct,
  onRemoved,
}: ConditionalRuleRowProps) {
  let { className: rowClassName, ...rowProps } = reorder.ofRow(conditionalFormatId, index);
  let ruleText = ruleSummary(rule);
  let hasCells = rule.cells !== '';
  let isMovable = !isAlone && hasCells;
  let editRule = () =>
    onAct({
      kind: 'editRule',
      conditionalFormatId,
    });
  let removeRule = () =>
    reorder.gliding(
      (onDone: (isDone: boolean) => void) =>
        onAct(
          {
            kind: 'removeRule',
            conditionalFormatId,
          },
          onDone,
        ),
      (isRemoved: boolean) => {
        if (isRemoved) onRemoved(index);
      },
    );
  let reorderHandle = <Tooltip content={isOnTouch ? CONDITIONAL_FORMATTING_WORDS.dragToReorder() : CONDITIONAL_FORMATTING_WORDS.keysThatMoveRule()} {...(reorder.areTooltipsOfHandlesShut
      ? {
          open: false,
        }
      : {})}><Button variant="ghost" {...(!isOnTouch && {
        size: 'xs',
      })} iconOnly icon={<Icon name="Reorder" size="xs" />} aria-label={reorderRuleLabel(joinMessageParts(ruleText))} aria-describedby={keysThatMoveSaidBy} tooltip={false} data-handle-of={conditionalFormatId} {...reorder.ofHandle(conditionalFormatId, index)} /></Tooltip>;
  let rowContent = <><RuleSample rules={{
          kind: 'one',
          rule,
        }} /><CardRowTexts title={ruleListWhat(rule)} second={ruleWhereWords(rule)} className={isOnTouch || !hasCells ? '' : wordsFadeUnderButtonProps.className} /></>;
  return <li {...rowProps} className={`group/rule ${rowClassName}`}><span {...REORDER_LIFT_PROPS} /><div className={`group-data-reorder/rule:bg-transparent! ${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><TooltipGroup closeDelay={0}>{isOnTouch &&
              !isAlone &&
              <span className={`-me-2 ms-1 flex items-center justify-center text-muted group-hover/rule:text-primary group-focus-within/rule:text-primary group-data-reorder/rule:text-primary ${RULE_HANDLE_SLOT_CLASSES.className}`}>{isMovable && reorderHandle}</span>}{hasCells
              ? (<button type="button" data-opens-rule {...cardRowButtonProps} {...(isMovable &&
                    !isOnTouch && {
                      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => reorder.pressOnRowItself(event, conditionalFormatId, index),
                    })} onClick={() => {
                    if (!reorder.isRowHeld) editRule();
                  }}>{rowContent}</button>)
              : (<><div {...cardRowButtonProps}>{rowContent}</div><Button variant="ghost" size="xs" data-opens-rule onClick={() =>
                        onAct({
                          kind: 'useSelectionFor',
                          conditionalFormatId,
                        })}>{CONDITIONAL_FORMATTING_WORDS.takeSelection()}</Button></>)}{!isOnTouch &&
              isMovable &&
              <span className="absolute start-1 top-1/2 -translate-y-1/2 rounded bg-surface-popover opacity-0 not-has-focus-visible:pointer-events-none has-focus-visible:opacity-100">{reorderHandle}</span>}{isOnTouch
              ? <Button variant="ghost" iconOnly icon="Minus" aria-label={removeRuleLabel(joinMessageParts(ruleText))} tooltip={CONDITIONAL_FORMATTING_WORDS.removeRule()} className="text-secondary" onClick={removeRule} />
              : <span className={`${cardRowEndButtonsProps.className} ${hasCells ? '' : 'static! opacity-100!'}`}><Button variant="ghost" iconOnly icon="Trash" aria-label={removeRuleLabel(joinMessageParts(ruleText))} tooltip={CONDITIONAL_FORMATTING_WORDS.removeRule()} className="text-secondary" onClick={removeRule} /></span>}</TooltipGroup></div></li>;
}
export const RULE_PREVIEW_REST_MS = 120;
export const RULE_HANDLE_SLOT_CLASSES = {
  className: 'w-9 flex-none',
  inRowWithNone: 'ps-10!',
};
export const ruleAskFieldWords = (): AskBoxWords => ({
  placeholder: CONDITIONAL_FORMATTING_WORDS.askAgentToMakeARule(),
  write: CONDITIONAL_FORMATTING_WORDS.writeRules(),
  writes: CONDITIONAL_FORMATTING_WORDS.writingRules(),
  stop: CONDITIONAL_FORMATTING_WORDS.stop(),
  hasFailed: CONDITIONAL_FORMATTING_WORDS.rulesNotWritten(),
  suggested: CONDITIONAL_FORMATTING_WORDS.suggested(),
  suggestedSaid: CONDITIONAL_FORMATTING_WORDS.suggestedByAgent(),
  askForMore: CONDITIONAL_FORMATTING_WORDS.askAgentForMore(),
  moreHasFailed: CONDITIONAL_FORMATTING_WORDS.moreSuggestionsFailed(),
  draftSaid: writtenByAgentUnsavedWords(),
});
export const ruleSuggestionKey = ({ rules }: Pick<ShownSuggestion, 'rules'>): string => JSON.stringify(rules);
export const offeredRuleEntry = (rule: RuleDescription, index: number): AskBoxRow => ({
  key: String(index),
  sample: <RuleSample rules={{
      kind: 'one',
      rule,
    }} />,
  title: ruleListWhat(rule),
  second: ruleWhereWords(rule),
});
export const ConditionalFormattingPane = React.memo(function ({
  pane,
  timesAsked,
  changesAskedFor,
  paneRef,
  takesNoTyping,
  paneWidth,
  onPaneWidthChange,
  onKeyDownInPane,
  whatHasCaretAfter,
  wasPointerPressedLast,
  whatColorPickerShows,
  onAct,
  lookOnceEventsAreFinished,
  onPressed,
  onShut,
  onAskAgent,
  onAskedInChat,
}: ConditionalFormattingPaneProps) {
  let paneShown = pane?.drawnAs === 'pane' ? pane : null;
  let isPaneOpen = paneShown !== null;
  let isOnTouch = useAnyCoarsePointer();
  let askFieldRef = React.useRef<HTMLInputElement>(null);
  let focusAskField = useFocusAskField(askFieldRef);
  let [typed, setTyped] = React.useState('');
  if (typed !== '' && (paneShown === null || paneShown.editor !== null || paneShown.agent === null)) setTyped('');
  let isForChat =
    paneShown !== null &&
    isAskTakenToChat(paneShown, {
      areWordsAsAsked: true,
      isChatToBeHad: onAskedInChat !== null,
    });
  let [isMakingNew, setIsMakingNew] = React.useState(false);
  if (isMakingNew && (paneShown === null || paneShown.editor !== null)) setIsMakingNew(false);
  let isMakingRule =
    isMakingNew ||
    (paneShown?.rules.length === 0 && !paneShown.isAskedForRules) ||
    typed.trim() !== '' ||
    (paneShown !== null && (paneShown.offer !== null || paneShown.agent === 'writes'));
  let rulesListRef = React.useRef<HTMLUListElement>(null);
  let backButtonRef = React.useRef<HTMLElement>(null);
  let agentRowsRef = React.useRef<HTMLUListElement>(null);
  let keysHintId = React.useId();
  let caretTargetRef = React.useRef<CaretTargetInRulesPane | null>(null);
  let isCaretInPane = () => {
    let paneDocument = paneRef.current?.ownerDocument;
    let activeElement = paneDocument?.activeElement ?? null;
    return activeElement === paneDocument?.body || paneRef.current?.contains(activeElement) === true;
  };
  let ruleIds = (paneShown?.rules ?? []).map(({ conditionalFormatId }) => conditionalFormatId);
  let editedRuleIndex = ruleIds.findIndex((ruleId) => ruleId === paneShown?.editor?.conditionalFormatId);
  let isEditorOpen = paneShown !== null && paneShown.editor !== null;
  let wasEditorOpenRef = React.useRef(isEditorOpen);
  let lastEditedRuleRef = React.useRef({
    at: 0,
    among: ruleIds,
  });
  let ruleOpenerAt = (ruleIndex: number) =>
    [...(rulesListRef.current?.querySelectorAll<HTMLElement>('[data-opens-rule]') ?? [])].find(
      (opener, index, openers) => index === Math.min(ruleIndex, openers.length - 1),
    );
  React.useLayoutEffect(() => {
    if (isEditorOpen && editedRuleIndex >= 0)
      lastEditedRuleRef.current = {
        at: editedRuleIndex,
        among: ruleIds,
      };
    if (wasEditorOpenRef.current === isEditorOpen) return;
    wasEditorOpenRef.current = isEditorOpen;
    let { at: lastRuleAt, among: lastRuleIds } = lastEditedRuleRef.current;
    let areRulesKept = !isEditorOpen && ruleIds.every((ruleId) => lastRuleIds.includes(ruleId));
    if (isPaneOpen && isCaretInPane() && paneRef.current?.ownerDocument.hasFocus() === true)
      caretTargetRef.current = areRulesKept
        ? {
            ruleAt: lastRuleAt,
          }
        : 'startOfView';
    else if (areRulesKept) {
      let opener = ruleOpenerAt(lastRuleAt);
      if (opener !== undefined) revealInSidePane(paneRef.current, opener, true);
    }
  });
  let wasMakingRuleRef = React.useRef(isMakingRule);
  let isSteppingBackRef = React.useRef(false);
  let isTakingAnswerRef = React.useRef(false);
  let [, forceRender] = React.useReducer((renders: number) => renders + 1, 0);
  let answerTimesRef = React.useRef(NO_LIST_ANSWER_TIMES);
  let noteActTime = (timeMs: number) => {
    answerTimesRef.current = {
      ...answerTimesRef.current,
      lastActAtMs: timeMs,
    };
  };
  let lastRemovedAtRef = React.useRef(-1 / 0);
  let isPressTooSoonRef = React.useRef(false);
  let isPressSwallowedRef = React.useRef(false);
  React.useLayoutEffect(() => {
    let [wasMakingRule, wasSteppingBack] = [wasMakingRuleRef.current, isSteppingBackRef.current];
    [wasMakingRuleRef.current, isSteppingBackRef.current] = [isMakingRule, false];
    if (wasMakingRule && !isMakingRule)
      answerTimesRef.current = {
        ...answerTimesRef.current,
        answerShownAtMs: performance.now(),
      };
    if (wasMakingRule === isMakingRule || isEditorOpen || !isPaneOpen) return;
    if (isMakingNew)
      focusPaneStart(paneRef.current, 'start', {
        isByPointer: wasPointerPressedLast(),
      });
    else if (isCaretInPane() && paneRef.current?.ownerDocument.hasFocus() === true)
      caretTargetRef.current =
        isMakingRule || wasSteppingBack
          ? 'startOfView'
          : isTakingAnswerRef.current
            ? null
            : {
                ruleAt: 0,
              };
    if (wasMakingRule && !isMakingRule && !isTakingAnswerRef.current)
      onAct({
        kind: 'pointAtSuggestion',
        rules: null,
      });
  });
  let isLookingForMore = paneShown?.moreFromAgent === 'isLookedFor';
  let wasLookingForMoreRef = React.useRef(isLookingForMore);
  React.useLayoutEffect(() => {
    if (wasLookingForMoreRef.current === isLookingForMore) return;
    wasLookingForMoreRef.current = isLookingForMore;
    let paneDocument = paneRef.current?.ownerDocument;
    let isCaretLost = paneDocument?.activeElement === paneDocument?.body && paneDocument?.hasFocus() === true;
    if (!isLookingForMore && isCaretLost && !wasPointerPressedLast()) caretTargetRef.current = 'firstOfAgent';
  });
  React.useLayoutEffect(() => {
    let caretTarget = caretTargetRef.current;
    caretTargetRef.current = null;
    if (caretTarget === null) return;
    if (wasPointerPressedLast() && !isCaretInPane()) return;
    if (caretTarget === 'startOfView') {
      let backButton = backButtonRef.current;
      if (backButton === null)
        focusPaneStart(paneRef.current, 'start', {
          isByPointer: wasPointerPressedLast(),
        });
      else
        backButton.focus({
          preventScroll: true,
          focusVisible: !wasPointerPressedLast(),
        });
      return;
    }
    let rulesList = rulesListRef.current;
    let target =
      caretTarget === 'firstOfAgent'
        ? (agentRowsRef.current?.querySelector('button') ?? undefined)
        : 'handleOf' in caretTarget
          ? [...(rulesList?.querySelectorAll<HTMLElement>('[data-handle-of]') ?? [])].find(
              (handle) => handle.dataset.handleOf === caretTarget.handleOf,
            )
          : ruleOpenerAt(caretTarget.ruleAt);
    if (target === undefined) {
      focusPaneStart(paneRef.current, 'start', {
        isByPointer: wasPointerPressedLast(),
      });
      return;
    }
    target.focus({
      preventScroll: true,
      focusVisible: !wasPointerPressedLast(),
    });
    revealInSidePane(paneRef.current, target, true);
  });
  let endPressGuard = () => {
    isPressSwallowedRef.current = false;
  };
  let pressGuardHandlers = (isAnswerShown: boolean): PressGuardHandlers => ({
    onPointerDownCapture: (event) => {
      isPressTooSoonRef.current = (isAnswerShown && isTakingAnswerRef.current) || isTooSoonAfterListAnswer(answerTimesRef.current, event.timeStamp);
      isPressSwallowedRef.current = isPressTooSoonRef.current || isWithinPressGuard(lastRemovedAtRef.current, event.timeStamp);
      if (isPressSwallowedRef.current) event.stopPropagation();
      if (isPressTooSoonRef.current) noteActTime(event.timeStamp);
    },
    onPointerUpCapture: (event) => {
      if (event.button !== 0) endPressGuard();
    },
    onPointerCancelCapture: endPressGuard,
    onKeyDownCapture: endPressGuard,
    onMouseDownCapture: (event) => {
      if (isPressSwallowedRef.current) event.preventDefault();
    },
    onClickCapture: (event) => {
      if (isPressSwallowedRef.current) {
        event.stopPropagation();
        if (isPressTooSoonRef.current) noteActTime(event.timeStamp);
        onPressed();
      }
      isPressSwallowedRef.current = false;
    },
  });
  let reorder = useReorderRows({
    listRef: rulesListRef,
    keys: (paneShown?.rules ?? []).map(({ conditionalFormatId }) => conditionalFormatId),
    onMoved: (conditionalFormatId: string, toIndex: number, onDone: (isMoved: boolean) => void) =>
      onAct(
        {
          kind: 'moveRule',
          conditionalFormatId,
          toIndex,
        },
        (isMoved) => {
          if (isMoved)
            caretTargetRef.current =
              wasPointerPressedLast() && !isOnTouch
                ? {
                    ruleAt: toIndex,
                  }
                : {
                    handleOf: conditionalFormatId,
                  };
          onDone(isMoved);
        },
      ),
    onDragEnded: onPressed,
    isRowPutBackPressed: false,
  });
  useSidePaneCaret({
    isOpen: isPaneOpen,
    isOpenInAnotherForm: pane !== null && !isPaneOpen,
    timesAsked,
    paneRef,
    putCaretWhereToStart: () =>
      void focusPaneStart(paneRef.current, 'start', {
        isByPointer: wasPointerPressedLast(),
      }),
    whatHasCaretAfter,
  });
  let previewAwaited = pane?.previewAwaited ?? null;
  React.useEffect(() => {
    if (previewAwaited === null) return;
    let timer = setTimeout(
      () =>
        onAct({
          kind: 'previewRested',
        }),
      RULE_PREVIEW_REST_MS,
    );
    return () => clearTimeout(timer);
  }, [previewAwaited, onAct]);
  if (paneShown === null) return null;
  let { moreFromAgent, editor, suggestions, rules } = paneShown;
  let paneFrameProps = {
    ref: paneRef,
    takesNoTyping,
    width: paneWidth,
    onWidthChange: onPaneWidthChange,
    onClose: onShut,
    onKeyDown: onKeyDownInPane,
    onPressed,
    wasPointerPressedLast,
  };
  let ownSuggestions = suggestions.filter(({ isFromAgent }) => !isFromAgent);
  let agentSuggestions = suggestions.filter(({ isFromAgent }) => isFromAgent);
  let statusAnnouncer = <LiveAnnouncer words={conditionalPaneStatusWords(paneShown, {
      isMakingRule,
      isTyped: typed.trim() !== '',
      areSomeOfAgent: agentSuggestions.length > 0,
      isForChat,
    })} />;
  let editedRule = editor === null ? null : ruleNumberOfConditionalFormat(rules, editor.conditionalFormatId);
  if (editor !== null)
    return <SidePane {...paneFrameProps} title={CONDITIONAL_FORMATTING_WORDS.editRule()} beforeTitle={<Button ref={backButtonRef} variant="ghost" iconOnly icon={<Icon name="ArrowLeft" size="sm" />} aria-label={CONDITIONAL_FORMATTING_WORDS.backToAllRules()} className="text-secondary" {...{
          [PANE_START_ATTRIBUTE]: true,
        }} onClick={() =>
          onAct({
            kind: 'leaveEditor',
          })} />} view="editor" actions={<Button variant="ghost" iconOnly icon={<Icon name="Trash" size="sm" />} aria-label={CONDITIONAL_FORMATTING_WORDS.removeRule()} className="text-secondary" onClick={() =>
          onAct({
            kind: 'removeRule',
            conditionalFormatId: editor.conditionalFormatId,
          })} />}><div className="contents [--sheet-pane-gutter:var(--ui-pad-lg)]"><ConditionalRuleEditor editor={editor} whatColorPickerShows={whatColorPickerShows} onAct={onAct} /></div>{statusAnnouncer}{onAskAgent !== null &&
          editedRule !== null &&
          <AskAgentAboutRuleSection key={editor.conditionalFormatId} rule={editedRule} onAskAgent={onAskAgent} />}</SidePane>;
  if (!isMakingRule)
    return <SidePane {...paneFrameProps} title={CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()} view="list"><ContentsBox {...pressGuardHandlers(false)} onKeyDownCapture={(event: React.KeyboardEvent<HTMLDivElement>) => {
            endPressGuard();
            if (event.key !== 'Enter' && event.key !== ' ') return;
            if (!isTooSoonAfterListAnswer(answerTimesRef.current, event.timeStamp)) return;
            event.preventDefault();
            event.stopPropagation();
            noteActTime(event.timeStamp);
          }}><div className="flex min-w-0 shrink-0 flex-col pt-md"><div className={`${cardRowFrameProps.className} ${CARD_ROW_HOVER_CLASSES}`}><button type="button" className={agentRowClassProps.className} {...{
                    [PANE_START_ATTRIBUTE]: true,
                  }} onClick={() => {
                    setIsMakingNew(true);
                    onAct({
                      kind: 'askForMoreSuggestions',
                    });
                  }}><AgentRowContent icon={<Icon name="Add" size="md" />}>{CONDITIONAL_FORMATTING_WORDS.createRule()}</AgentRowContent></button></div></div><section className="flex min-w-0 shrink-0 flex-col pb-2">{rules.length > 0 &&
                  <CardSectionHeading>{CONDITIONAL_FORMATTING_WORDS.rules()}</CardSectionHeading>}{paneShown.notWorkedOut !== null &&
                  <output className="block pb-1 ps-lg pe-md text-footnote text-secondary">{rulesNotAppliedReason(paneShown.notWorkedOut)}</output>}<ul ref={rulesListRef} className="flex flex-col">{rules.map(
                    (rule, index) =>
                      (<ConditionalRuleRow key={rule.conditionalFormatId} rule={rule} index={index} isAlone={rules.length === 1} isOnTouch={isOnTouch} reorder={reorder} keysThatMoveSaidBy={keysHintId} onAct={onAct} onRemoved={(removedAt) => {
                            caretTargetRef.current = {
                              ruleAt: removedAt,
                            };
                            lastRemovedAtRef.current = performance.now();
                          }} />),
                  )}</ul><span id={keysHintId} hidden>{CONDITIONAL_FORMATTING_WORDS.keysThatMoveRule()}</span></section></ContentsBox>{statusAnnouncer}</SidePane>;
  let rulesOfSuggestionKey = (suggestionKey: string) =>
    suggestions.find((suggestion) => ruleSuggestionKey(suggestion) === suggestionKey)?.rules ?? null;
  let answerOffer = (kind: 'keepOffer' | 'discardOffer') => {
    focusAskField();
    if (kind === 'keepOffer')
      takeAnswer({
        kind,
      });
    else
      onAct({
        kind,
      });
  };
  let [firstOffered, ...otherOffered] = paneShown.offer?.each ?? [];
  let draft: AgentDraft | null =
    paneShown.offer === null || firstOffered === undefined
      ? null
      : otherOffered.length === 0
        ? {
            toTake: offeredRuleEntry(firstOffered, 0),
            shown: [],
          }
        : {
            toTake: {
              key: 'all',
              sample: <SeveralRulesSample rules={paneShown.offer.each} />,
              title: [addRulesLabel(paneShown.offer.each.length)],
            },
            shown: paneShown.offer.each.map(offeredRuleEntry),
          };
  let hasRulesOrAsked = rules.length > 0 || paneShown.isAskedForRules;
  let clearAskField = () => {
    setTyped('');
    setIsMakingNew(false);
  };
  let takeAnswer = (answer: RulesPaneAction) => {
    isTakingAnswerRef.current = true;
    let takenAtMs = performance.now();
    answerTimesRef.current = {
      answerShownAtMs: takenAtMs,
      lastActAtMs: takenAtMs,
    };
    clearAskField();
    onAct(answer);
    lookOnceEventsAreFinished(() => {
      isTakingAnswerRef.current = false;
      answerTimesRef.current = {
        ...answerTimesRef.current,
        answerShownAtMs: performance.now(),
      };
      if (isCaretInPane() && paneRef.current?.ownerDocument.hasFocus() === true)
        caretTargetRef.current = {
          ruleAt: 0,
        };
      forceRender();
    });
  };
  return <SidePane {...paneFrameProps} title={hasRulesOrAsked ? CONDITIONAL_FORMATTING_WORDS.createRule() : CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()} view="newRule" {...(hasRulesOrAsked && {
      beforeTitle: (<Button variant="ghost" iconOnly icon={<Icon name="ArrowLeft" size="sm" />} aria-label={CONDITIONAL_FORMATTING_WORDS.backToAllRules()} className="text-secondary" onClick={() => {
          isSteppingBackRef.current = true;
          if (paneShown.doesEscapeStepBack)
            onAct({
              kind: 'stepBack',
            });
          onAct({
            kind: 'pointAtSuggestion',
            rules: null,
          });
          clearAskField();
        }} />),
    })}><RuleAskBox words={ruleAskFieldWords()} typed={typed} onTyped={setTyped} changesAskedFor={changesAskedFor} fieldRef={askFieldRef} markOfStart={{
          [PANE_START_ATTRIBUTE]: true,
        }} agent={paneShown.agent} draft={draft} ofAgent={agentSuggestions.map(ruleSuggestionEntry)} moreOfAgent={moreFromAgent === null || moreFromAgent === 'isNone'
            ? null
            : moreFromAgent === 'isLookedFor'
              ? 'isLookedFor'
              : moreFromAgent === 'couldNotBeLookedFor'
                ? 'hasFailed'
                : 'canBeAsked'} own={ownSuggestions.map(ruleSuggestionEntry)} ofAgentRef={agentRowsRef} chatInstead={isForChat && onAskedInChat !== null
            ? {
                whyNotHere: CONDITIONAL_FORMATTING_WORDS.rulesAloneCantDoIt(),
                goThere: CONDITIONAL_FORMATTING_WORDS.goToChatForRules(),
                onAsked: (words: string) =>
                  void onAskedInChat(words).then((isAdded) => {
                    if (isAdded) setTyped((typedNow) => (typedNow === typed ? '' : typedNow));
                    return;
                  }),
              }
            : null} onAsked={(words) =>
          onAct({
            kind: 'askAgent',
            words,
            canChatTakeIt: onAskedInChat !== null,
          })} onStopped={() =>
          onAct({
            kind: 'stepBack',
          })} onKept={() => answerOffer('keepOffer')} onDiscarded={() => answerOffer('discardOffer')} kindsToSetUp={[
          {
            key: 'formatWhere',
            icon: 'TextHighlight',
            label: CONDITIONAL_FORMATTING_WORDS.addHighlightRule(),
          },
          {
            key: 'colorScale',
            icon: 'ColorScale',
            label: CONDITIONAL_FORMATTING_WORDS.addColorScaleRule(),
          },
        ]} onKindSetUp={(kind) =>
          onAct({
            kind: 'startRule',
            effect: kind === 'colorScale' ? 'colorScale' : 'formatWhere',
          })} onPointedAt={(suggestionKey) =>
          onAct({
            kind: 'pointAtSuggestion',
            rules: suggestionKey === null ? null : rulesOfSuggestionKey(suggestionKey),
          })} onTaken={(suggestionKey) => {
          let rulesTaken = rulesOfSuggestionKey(suggestionKey);
          if (rulesTaken !== null)
            takeAnswer({
              kind: 'takeSuggestion',
              rules: rulesTaken,
            });
        }} onAskedForMore={() =>
          onAct({
            kind: 'askForMoreSuggestions',
          })} deafToPointer={pressGuardHandlers(true)} />{statusAnnouncer}</SidePane>;
});
