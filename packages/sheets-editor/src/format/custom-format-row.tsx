import { Menu } from '../kit/menu.tsx';
import { ShimmerText } from '../kit/shimmer-text.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import { parseSingleShortcut } from '../kit/shortcut.tsx';
import * as React from 'react';
import type { CustomNumberFormat } from '../state/initial-state.ts';
import type { HowActBegan } from './answer-holds.ts';
import type { CustomFormatAgent, WhyAgentCameToNothing } from './custom-number-format.ts';
import { translateMessage } from '../i18n/messages.ts';
import { OfferWand, WordsInTurn } from '../formulas/from-words/offer-list.tsx';
import { StopKeyHint, stopKeyHintOf } from '../agent/agent-rows.tsx';
import { stopWritingFormulaLabel, escapeKeyHint } from '../messages/formula-writing.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { formatPreviewText, customFormatProblemText } from '../i18n/format-labels.ts';
import { useActHoldAtAnswer } from '../agent/answer-holds.tsx';
import { customPatternListText } from './custom-number-format.ts';
import { isSafariLateEnter } from '../ui/menu-with-field.tsx';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
/** Where the agent stands with a custom pattern, as its row in the list or its line in the dialog shows it. */
export type CustomFormatStage =
  | { kind: 'offered'; hasCallFailed: boolean }
  | { kind: 'asked'; hasCallFailed?: never }
  | { kind: 'cameToNothing'; why: Exclude<WhyAgentCameToNothing, 'callFailed'> };
export type CustomFormatStageKind = CustomFormatStage['kind'];
/** A stage the agent's row shows as a button rather than as a problem. */
export type AgentRowStage = Exclude<CustomFormatStage, { kind: 'cameToNothing' }>;
/** The handlers a hold on acts puts on the element that takes the acts. */
export interface ActHoldHandlers {
  onPointerDownCapture: (event: React.PointerEvent) => void;
  onPointerUpCapture: (event: React.PointerEvent) => void;
  onPointerCancelCapture: () => void;
  onClickCapture: () => void;
  onKeyDownCapture: (event: React.KeyboardEvent) => void;
  onKeyUpCapture: (event: React.KeyboardEvent) => void;
}
/** A hold on acts begun before the agent's answer was seen. */
export interface ActHoldAtAnswer {
  handlers: ActHoldHandlers;
  noteKeyThatTakesNothing: () => void;
  howActBegan: () => HowActBegan;
  isActRefused: () => boolean;
}
/** What the list of number formats tells the page of the custom pattern typed in its search field. */
export interface CustomFormatListTold {
  onTyped: (text: string) => void;
  onAgentAsked: (howActBegan: HowActBegan) => void;
  onEscaped: () => void;
  onEntered: (howActBegan: HowActBegan) => void;
  onActHeld: (howActBegan: HowActBegan) => void;
  onTaken: () => void;
}
/** The custom pattern typed in the list of number formats, as the page hands it to the list. */
export interface CustomFormatInList {
  entry: CustomNumberFormat | null;
  isAgentOffered: boolean;
  told: CustomFormatListTold;
}
export interface CustomFormatActs {
  ask: () => void;
  take: (event?: React.MouseEvent<HTMLElement>) => void;
  isActTooSoon: () => boolean;
}
/** The custom pattern row of the list of number formats, with what its keys and clicks do. */
export interface CustomFormatList extends CustomFormatActs {
  entry: CustomNumberFormat | null;
  text: string;
  onTyped: (text: string) => void;
  stage: CustomFormatStage | null;
  takesTypedPattern: boolean;
  handlers: ActHoldHandlers;
  noteKeyThatTakesNothing: () => void;
  isLateEnterOfInputMethod: (event: KeyboardEvent) => boolean;
  stepBack: () => void;
}
/** A key pressed while the list of number formats is open, and where. */
export interface CustomFormatKeyPress {
  key: string;
  on: 'field' | 'thisRow' | 'anotherRow';
  isHeldDown: boolean;
  isWithModifier: boolean;
  isOfInputMethod: boolean;
}
export type CustomFormatKeyAction = 'stepBack' | 'ask' | 'take' | 'nothing' | 'listsOnceSeen';
export function formatWritingProblemText(why: WhyAgentCameToNothing): string {
  switch (why) {
    case 'noFormat':
      return translateMessage({
        defaultMessage: 'Couldn’t turn that into a format. Try other words.',
        id: '4wKXsuLlqF',
      });
    case 'callFailed':
      return translateMessage({
        defaultMessage: 'Couldn’t write a format. Try again.',
        id: 'spuDz/O+ok',
      });
    case 'notAvailable':
      return translateMessage({
        defaultMessage: 'Agent isn’t available in this Sheet.',
        id: 'DW/2qfoHKi',
      });
  }
}
export function customFormatStage(agent: CustomFormatAgent | null, isOffered: boolean): CustomFormatStage | null {
  if (isOffered)
    return {
      kind: 'offered',
      hasCallFailed: agent?.kind === 'cameToNothing',
    };
  if (agent?.kind === 'asked')
    return {
      kind: 'asked',
    };
  return agent?.kind === 'cameToNothing' && agent.why !== 'callFailed'
    ? {
        kind: 'cameToNothing',
        why: agent.why,
      }
    : null;
}
export function useOfferTakesEnter(isOfferSaid: boolean) {
  let [isReady, setIsReady] = React.useState(false);
  React.useEffect(() => {
    if (!isOfferSaid) return;
    let timer = setTimeout(() => setIsReady(true), OFFER_ENTER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setIsReady(false);
    };
  }, [isOfferSaid]);
  return isOfferSaid && isReady;
}
export interface CustomFormatAgentRowProps {
  id: string;
  stage: CustomFormatStage;
  onAgentAsked: () => void;
  onStopped: () => void;
}
export function CustomFormatAgentRow({ id, stage, onAgentAsked, onStopped }: CustomFormatAgentRowProps) {
  if (stage.kind === 'cameToNothing')
    return <p id={id} className={`sheet-line-under-field box-content min-h-[1lh] text-footnote ${stage.why === 'noFormat' ? 'text-danger' : 'text-secondary'}`}>{formatWritingProblemText(stage.why)}</p>;
  let isOffered = stage.kind === 'offered';
  let hasCallFailed = isOffered && stage.hasCallFailed;
  let offerText = hasCallFailed ? formatWritingProblemText('callFailed') : writeThisFormatLabel();
  return <button id={id} type="button" tabIndex={-1} className={`sheet-line-under-field flex w-full cursor-default items-start gap-1.5 text-start text-footnote text-primary *:min-h-[1lh] ${isOffered ? 'sheet-line-under-enter' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={isOffered ? onAgentAsked : onStopped}><OfferWand kind={stage.kind} /><span className={hasCallFailed ? 'min-w-0 flex-1' : 'min-w-0 flex-1 truncate'}>{isOffered
          ? offerText
          : <ShimmerText>{writingFormatLabel()}</ShimmerText>}</span><StopKeyHint word={stopWritingFormulaLabel()} isSmall keyInWords={escapeKeyHint()} isShown={!isOffered} /></button>;
}
export interface CustomFormatAnnouncerProps {
  entry: Pick<CustomNumberFormat, 'pattern' | 'agent'>;
  isOfferSaid: boolean;
  example: string;
}
export function CustomFormatAnnouncer({ entry: { pattern, agent }, isOfferSaid, example }: CustomFormatAnnouncerProps) {
  let doesOfferTakeEnter = useOfferTakesEnter(isOfferSaid && agent === null);
  if (agent === null)
    return <LiveAnnouncer words={doesOfferTakeEnter && notAFormatAnnouncement()} />;
  if (agent.kind === 'asked')
    return <LiveAnnouncer words={agentWritingFormatAnnouncement()} />;
  if (agent.kind !== 'wrote')
    return <LiveAnnouncer words={null} />;
  let exampleText = example === '' ? '' : ` ${formatPreviewText(example)}`;
  return <LiveAnnouncer words={agentWroteFormatAnnouncement(pattern) + exampleText} />;
}
export function useCustomFormatList({ entry, isAgentOffered, told }: CustomFormatInList, takesTypedPattern: boolean): CustomFormatList {
  let stage = customFormatStage(entry?.agent ?? null, entry !== null && isAgentOffered);
  let actGate: ActHoldAtAnswer = useActHoldAtAnswer({
    hold: entry?.hold ?? null,
    tellOfActHeld: () => told.onActHeld({}),
    isNoAct: isFieldInput,
  });
  let compositionEndRef = React.useRef(Number.NEGATIVE_INFINITY);
  let ownWindow = useUiWindow();
  let ownDocument = ownWindow?.document;
  let hasEntry = entry !== null;
  React.useEffect(() => {
    if (!hasEntry) return;
    let noteCompositionEnd = ({ timeStamp }: CompositionEvent) => {
      compositionEndRef.current = timeStamp;
    };
    ownDocument?.addEventListener('compositionend', noteCompositionEnd, true);
    return () => ownDocument?.removeEventListener('compositionend', noteCompositionEnd, true);
  }, [ownDocument, hasEntry]);
  return {
    entry,
    text: customPatternListText({
      customNumberFormat: entry,
    }),
    onTyped: told.onTyped,
    stage,
    takesTypedPattern,
    handlers: actGate.handlers,
    noteKeyThatTakesNothing: actGate.noteKeyThatTakesNothing,
    isLateEnterOfInputMethod({ key, timeStamp }: KeyboardEvent) {
      let msSinceComposition = timeStamp - compositionEndRef.current;
      compositionEndRef.current = Number.NEGATIVE_INFINITY;
      return key === 'Enter' && isSafariLateEnter(msSinceComposition, (ownWindow ?? window).navigator.vendor);
    },
    stepBack: told.onEscaped,
    ...customFormatActs(actGate, told),
  };
}
export function customFormatRowLabel(list: CustomFormatList) {
  let { entry, stage } = list;
  if (entry !== null && isTypedPatternTaken(list)) return entry.pattern.trim();
  return stage?.kind === 'offered' && !stage.hasCallFailed ? writeThisFormatLabel() : null;
}
export function customFormatKeyAction(press: CustomFormatKeyPress, list: CustomFormatList, canOffer: boolean): CustomFormatKeyAction | null {
  let { entry, stage } = list;
  if (entry === null || press.isOfInputMethod || press.isWithModifier) return null;
  let isAsked = stage?.kind === 'asked';
  if (press.key === 'Escape') return isAsked || isAgentFormatWritten(entry) ? 'stepBack' : null;
  if (!(press.key === 'Enter' || (press.key === ' ' && press.on === 'thisRow'))) return null;
  let listsOnceSeen: 'listsOnceSeen' | null = entry.hold !== null && entry.hold.stands !== 'awaited' ? 'listsOnceSeen' : null;
  if (press.on === 'anotherRow') return listsOnceSeen;
  if (press.isHeldDown || isAsked) return 'nothing';
  let canTake = isAgentFormatWritten(entry) || isTypedPatternTaken(list);
  if (press.on === 'thisRow') return null;
  let isOfferLive = canOffer && (stage?.kind === 'offered' || isTypedPatternTaken(list));
  if (!isAgentBusyOrDone(list) && !isOfferLive) return listsOnceSeen;
  return canTake ? 'take' : 'ask';
}
export function handleCustomFormatKey(list: CustomFormatList, event: React.KeyboardEvent, canOffer: boolean) {
  let action = customFormatKeyAction(
    {
      key: event.key,
      on: isFieldInput(event.target)
        ? 'field'
        : event.target instanceof Element && event.target.hasAttribute(CUSTOM_FORMAT_ROW_ATTRIBUTE)
          ? 'thisRow'
          : 'anotherRow',
      isHeldDown: event.repeat,
      isWithModifier: event.shiftKey || event.altKey || event.ctrlKey || event.metaKey,
      isOfInputMethod: list.isLateEnterOfInputMethod(event.nativeEvent) || event.nativeEvent.isComposing || event.keyCode === 229,
    },
    list,
    canOffer,
  );
  if (action === 'stepBack') list.stepBack();
  if (action === 'ask') list.ask();
  if (action === 'take') list.take();
  if (action === 'nothing') list.noteKeyThatTakesNothing();
  return action === 'listsOnceSeen' ? list.isActTooSoon() : action !== null;
}
export function customFormatRowProblemText({ entry, stage }: Pick<CustomFormatList, 'entry' | 'stage'>) {
  if (hasOfferCallFailed(stage)) return formatCallFailedAnnouncement();
  if (stage?.kind === 'cameToNothing') return formatWritingProblemText(stage.why);
  return entry?.reading.kind === 'refused' && entry.isRefusalTold ? customFormatProblemText(entry.reading.why) : null;
}
export function agentRowWords(stage: AgentRowStage) {
  if (stage.kind === 'asked')
    return {
      words: writingFormatLabel(),
      isShimmering: true,
      takeAPlace: true,
    };
  return stage.hasCallFailed
    ? {
        words: formatWritingProblemText('callFailed'),
        isShimmering: false,
        takeAPlace: true,
        doWordsWrap: true,
      }
    : {
        words: writeThisFormatLabel(),
        isShimmering: false,
        takeAPlace: false,
      };
}
export interface CustomFormatRowProps {
  list: CustomFormatList;
  isUnderEnter: boolean;
  /** The row to show in place of the agent's when there is no pattern to take, with the problem to describe. */
  rowToDialog: (problem: string | null) => React.ReactNode;
  ref: React.Ref<HTMLElement>;
}
export function CustomFormatRow({ list, isUnderEnter, rowToDialog, ref }: CustomFormatRowProps) {
  let { entry, stage } = list;
  let isPatternTaken = entry !== null && (isAgentFormatWritten(entry) || isTypedPatternTaken(list));
  let stopTrailing = stopKeyHintOf({
    word: stopWritingFormulaLabel(),
    ...stopHintOfAgentRow(isPatternTaken ? null : (stage?.kind ?? null)),
  });
  if (entry !== null && isPatternTaken)
    return <Menu.Item ref={ref} icon="Sliders" labelDir="auto" hint={patternExample(entry)} hintDir="auto" keepOpen {...CUSTOM_FORMAT_ROW_PROPS} {...((isAgentFormatWritten(entry) || isUnderEnter) && ROW_UNDER_ENTER_PROPS)} onClick={list.take}><WordsInTurn {...writtenFormatWords(entry)} /></Menu.Item>;
  if (stage === null || stage.kind === 'cameToNothing') return rowToDialog(customFormatRowProblemText(list));
  let isOffered = stage.kind === 'offered';
  return <Menu.Item ref={ref} icon={<OfferWand kind={stage.kind} />} keepOpen {...CUSTOM_FORMAT_ROW_PROPS} label="" {...(isEnterForOffer(stage, isUnderEnter) && ROW_UNDER_ENTER_PROPS)} {...agentRowTrailingProps(stage.kind, stopTrailing)} onClick={isOffered ? list.ask : list.stepBack}><WordsInTurn {...agentRowWords(stage)} /></Menu.Item>;
}
export type CustomFormatRowInViewProps = Omit<CustomFormatRowProps, 'ref'>;
export function CustomFormatRowInView(props: CustomFormatRowInViewProps) {
  let { list } = props;
  let rowRef = React.useRef<HTMLElement>(null);
  let agentKind = isAgentBusyOrDone(list) ? list.entry?.agent?.kind : undefined;
  React.useLayoutEffect(() => {
    if (agentKind !== undefined)
      rowRef.current?.scrollIntoView({
        block: 'nearest',
      });
  }, [agentKind]);
  return <CustomFormatRow {...props} ref={rowRef} />;
}
export interface CustomFormatListAnnouncerProps {
  list: CustomFormatList;
}
export function CustomFormatListAnnouncer({ list }: CustomFormatListAnnouncerProps) {
  let { entry } = list;
  let isPatternShown = entry !== null && (entry.agent?.kind !== 'wrote' || isAgentFormatWritten(entry));
  return <><CustomFormatAnnouncer entry={isPatternShown
          ? entry!
          : {
              pattern: '',
              agent: null,
            }} isOfferSaid={false} example={isPatternShown ? patternExample(entry!) : ''} /><LiveAnnouncer words={customFormatRowProblemText(list)} /></>;
}
export const writeThisFormatLabel = () =>
  translateMessage({
    defaultMessage: 'Write this format',
    id: 'uC+O5lIsI2',
  });
export const writingFormatLabel = () =>
  translateMessage({
    defaultMessage: 'Writing a format…',
    id: 'iKv8Su27n8',
  });
export const notAFormatAnnouncement = () =>
  translateMessage({
    defaultMessage: 'This isn’t a format. Press Enter to have Agent write one.',
    id: 'o9Pai+4K+d',
  });
export const formatCallFailedAnnouncement = () =>
  translateMessage({
    defaultMessage: 'Couldn’t write a format. Press Enter to try again.',
    id: '+hOHriIqN5',
  });
export const agentWritingFormatAnnouncement = () =>
  translateMessage({
    defaultMessage: 'Agent is writing the format. Press Escape to stop.',
    id: 'RdODbmvZWg',
  });
export const agentWroteFormatAnnouncement = (pattern: string) =>
  translateMessage(
    {
      defaultMessage: 'Agent wrote {pattern}. Press Enter to apply it, or Escape to discard it.',
      id: '9xGI2TtDFt',
    },
    {
      pattern,
    },
  );
export const withoutOfferWhenTyping = (stage: CustomFormatStage | null, isRefusalTold: boolean | undefined) =>
  isRefusalTold && stage?.kind === 'offered' ? null : stage;
export const OFFER_ENTER_DELAY_MS = 300;
export const isFieldInput = (target: EventTarget) => target instanceof HTMLInputElement;
export const CUSTOM_FORMAT_ROW_ATTRIBUTE = 'data-is-custom-format-row';
export const CUSTOM_FORMAT_ROW_PROPS = {
  [CUSTOM_FORMAT_ROW_ATTRIBUTE]: '',
};
export const isEnterForOffer = (stage: CustomFormatStage | null, isRowUnderEnter: boolean) =>
  stage?.kind === 'offered' && (isRowUnderEnter || stage.hasCallFailed);
export const customFormatActs = (actGate: ActHoldAtAnswer, told: CustomFormatListTold): CustomFormatActs => ({
  ask: () => told.onAgentAsked(actGate.howActBegan()),
  take(event?: React.MouseEvent<HTMLElement>) {
    if (!actGate.isActRefused()) {
      if (event !== undefined) swallowRestOfPress(event);
      told.onTaken();
    }
    told.onEntered(actGate.howActBegan());
  },
  isActTooSoon() {
    if (!actGate.isActRefused()) return false;
    told.onActHeld(actGate.howActBegan());
    return true;
  },
});
export const isAgentFormatWritten = (entry: CustomNumberFormat | null) => entry?.agent?.kind === 'wrote' && entry.reading.kind === 'numberFormat';
export const isTypedPatternTaken = ({ entry, takesTypedPattern }: Pick<CustomFormatList, 'entry' | 'takesTypedPattern'>) =>
  takesTypedPattern && entry?.reading.kind === 'numberFormat' && entry.agent?.kind !== 'wrote';
export const patternExample = ({ reading }: Pick<CustomNumberFormat, 'reading'>) =>
  reading.kind === 'numberFormat' ? (reading.example?.trim() ?? '') : '';
export const hasOfferCallFailed = (stage: CustomFormatStage | null) => stage?.kind === 'offered' && stage.hasCallFailed;
export const isAgentBusyOrDone = ({ entry, stage }: Pick<CustomFormatList, 'entry' | 'stage'>) =>
  stage?.kind === 'asked' || isAgentFormatWritten(entry) || hasOfferCallFailed(stage);
export const ROW_UNDER_ENTER_PROPS = {
  className: 'sheet-row-under-enter',
};
export const writtenFormatWords = (entry: CustomNumberFormat) => ({
  words: entry.pattern.trim(),
  isShimmering: false,
  takeAPlace: false,
  doWordsWrap: true,
});
export const stopHintOfAgentRow = (stageKind: CustomFormatStageKind | null) => ({
  isShown: stageKind === 'asked',
  goesAtOnce: stageKind !== 'asked' && stageKind !== 'offered',
});
export const agentRowTrailingProps = (stageKind: AgentRowStage['kind'], trailing: React.ReactNode) => ({
  ...(trailing !== null && {
    trailing,
  }),
  ...(stageKind === 'asked' && {
    'aria-keyshortcuts': parseSingleShortcut('esc', false),
  }),
});
