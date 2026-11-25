import { Surface } from '../kit/surface.tsx';
import { SelectionFrame, type SelectionFrameProps } from '../kit/selection-frame.tsx';
import { TooltipGroup } from '../kit/tooltip.tsx';
import { Button, type ButtonProps } from '../kit/button.tsx';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import {
  chartProblemWords,
  chartFixAsk,
  chartProblemOfFault,
  chartChangeRefusalWords,
  askSentToChatWords,
  isAskTaken,
  chartMessages,
  type AskSentToChat,
  type ChartChangeOutcome,
  type ChartProblem,
} from '../messages/charts.ts';
import { useChartNotice, NoChartNotice, ChartNoticeScope, ChartNoticeGate, ChartNoticesProvider, CallWhenNoticeDue } from './chart-notices.tsx';
import { PlacedViewFixOffer, isViewBigEnoughForFix, PlacedViewFixContext, FIX_OF_PLACED_VIEW_CLASS, type PlacedViewFix } from './fix-of-placed-view.tsx';
import { ChartCellsProblemNotice, ChartOnItsWay, type StyleWithCustomProperties } from './chart-placeholders.tsx';
import { canAskChartChange, chartCellsProblem, chartChangeOffers } from './change-offers.ts';
import { stripFrameTimestampParams } from '../shell/frame-token.ts';
import { ChartFrame, type ChartFrameTold, type PointerToChartFrame } from './chart-frame.tsx';
import { whenBlurredToNothingChecked } from '../grid/focus-left.ts';
import { useAnyCoarsePointer } from '../app/media-queries.ts';
import { useFocusFallbackToButton } from '../ui/focus-fallback.ts';
import { useShutOnWindowBlur } from '../ui/popup-given-up-on-blur.ts';
import { waitForNextTask } from '../dom/next-task.ts';
import {
  shownChartNode,
  shouldAskInChatInstead,
  chartChangeAsked,
  chartChangeAnswered,
  chartAskFaultShown,
  chartNodesToDraw,
  isShownChartNodeSettled,
  shouldHoldEnterOnChange,
  chartChangeStage,
  letGoOfChartChange,
  chartChangeKept,
  chartChangeDrawn,
  isKeptChartChangeOutdated,
  chartChangeKeptChecked,
  type AskedChartChange,
  type ChartAsk,
  type ChartCameOut,
  type ChartChange,
  type KeyInAskBox,
} from './ask-to-change-chart.ts';
import { cleanAskWords, MAX_ASK_WORDS_LENGTH } from '../agent/chat-with-agent.ts';
import { cycleTabFocusForward } from '../ui/dom-events.ts';
import { ChartAskMenu } from './chart-ask-menu.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { ChartBeingMade } from './chart-being-made.tsx';
import { useIsTrueForVisibleMs } from '../ui/save-status.tsx';
import { makeThisChartKindPrompt, type ChartKindOrAny } from './chart-words.ts';
import { canSwapChartKind } from './chart-kind-fit.ts';
import { STOCK_KINDS, type StockKind } from './stock-programs.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { ChartInputs, PointAt } from '../chart-frame/messages.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { PlacedViewAct } from '../state/event-reducer.ts';
import type { ChartFrameFault } from './frame-messages.ts';
import type { PlacedViewToDraw } from './placed-views.ts';
import type { ChartEditsByAgent } from './agent-edits.ts';
import type { ChartCode, ChartCodeSource, WhyNoChartCode } from './chart-code.ts';
import type { ChartFrameDocumentSource } from './frame-document.ts';
import type { AskForEditOfChart, ChartNodeSwap } from './widget-nodes.ts';
import type { createChartTapTracker } from './chart-taps.ts';
import type { ChartBeingMadeShown } from './chart-being-made-state.ts';
/** A tap on a placed view: the placement, and where in the chart it landed. */
export interface TapOnPlacedView extends PointAt {
  placementId: string;
}
/** What drawn charts read their code and the page of their frame from. */
export interface ChartsRunOn {
  code: ChartCodeSource;
  frameDocument: ChartFrameDocumentSource;
}
/** Sends words about a view to the chat with the agent. */
export type SendToAgentAboutView = (viewId: string, words: string) => Promise<AskSentToChat>;
/** Where the caret came from or went to when it came to or left a placed view. */
export type CaretOtherEnd = EventTarget | 'onNothing' | 'outOfWindow';
/** Where the caret went when it left a placed view: out of the window, onto nothing, or into the placement an element is part of (if any). */
export type CaretGoneTo = 'outOfWindow' | 'onNothing' | { partOf: string | null };
/** A key pressed while a placed view has the caret, and when it was made. */
export interface KeyOnPlacedView {
  key: string;
  isCharacter: boolean;
  isOnChartItself: boolean;
  madeAtMs: number;
}
/** What the page can do with the card under a chart that asks for a change of it. */
export interface CardUnderChart {
  open: (placementId: string) => void;
  canAgentChange: (placementId: string) => boolean;
  isChangeUnderWay: (placementId: string) => boolean;
  edit: (placementId: string) => void;
  takeKey: (placementId: string, keyPress: KeyOnPlacedView) => boolean;
}
/** Changes what was asked about a chart, from what it is now. */
export type UpdateOfChartAsk = (ask: ChartAsk) => Partial<ChartAsk>;
/** How the caret is to come to a placed view that was selected. */
export interface CaretToPlacedView {
  isCaretOfPressOnItsWay: boolean;
  hasPageCaret: boolean;
  isCaretFreeToGo: boolean;
}
/** Whether a chart shows a notice instead of its code, or waits for its code or frame page. */
export interface ChartCodeLooks {
  isNoticeShown: boolean;
  isAwaited: boolean;
}
/** Where the caret is when the card under a chart is closed. */
export interface CaretAtCardClose {
  hasWindowKeyboard: boolean;
  isCaretAtCardOrTools: boolean;
  wasPencilPressedByKey: boolean;
}
/** A press: whether the window has focus, when the press was made, the time now and when the window last lost focus. */
export interface PressInWindow {
  hasWindowFocus: boolean;
  madeAtMs: number;
  nowMs: number;
  lastBlurAtMs: number;
}
/** A press of the edit button of a placed view, and how its card stands. */
export interface PressOfEditButton {
  isWindowLeft: boolean;
  isKeyBeforeCardHasCaret: boolean;
  isCardOpen: boolean;
  isCardOffered: boolean;
}
interface ChartCantBeShownNoticeProps {
  why: ChartProblem;
  ofCode?: string | null;
}
export function ChartCantBeShownNotice({ why, ofCode = null }: ChartCantBeShownNoticeProps) {
  let { title, advice } = chartProblemWords(why);
  useChartNotice(title, ofCode);
  let fixButton = PlacedViewFixOffer(chartFixAsk(why));
  return <div className="flex size-full flex-col items-center justify-center gap-xs p-md text-center"><p className="text-body font-medium text-primary">{title}</p>{fixButton ??
        <p className="text-footnote text-secondary">{advice}</p>}</div>;
}
interface ChartDrawingProps {
  frameDocument: string;
  artifact: string;
  inputs: ChartInputs;
  /** The size the chart is drawn at while it is not held ("width height"), or null while it is held. */
  sizeAtRest: string | null;
  name: string;
  takesOverFromSkeleton: boolean;
  onCameOut: (cameOut: ChartCameOut) => void;
  tellsOfPointer: React.Ref<PointerToChartFrame>;
  onCaretTaken: () => void;
  onCodeTookCaret: () => void;
  onCodeTookTooLong: () => void;
}
/** Where drawing a chart stands: on its way, drawn, left by its frame at a size, or failed for the inputs and size it was drawn at. */
type ChartDrawingStands =
  | 'onItsWay'
  | 'drawn'
  | { leftAt: string | null }
  | { fault: ChartFrameFault; inputs: ChartInputs; size: string | null };
interface ChartDrawingState {
  nth: number;
  stands: ChartDrawingStands;
}
export function ChartDrawing({
  frameDocument,
  artifact,
  inputs,
  sizeAtRest,
  name,
  takesOverFromSkeleton,
  onCameOut,
  tellsOfPointer,
  onCaretTaken,
  onCodeTookCaret,
  onCodeTookTooLong,
}: ChartDrawingProps) {
  const [{ nth, stands }, setDrawing] = React.useState<ChartDrawingState>({
    nth: 1,
    stands: 'onItsWay',
  });
  let onTold: ChartFrameTold = (outcome, inputsOfOutcome) => {
    let size = typeof stands === 'object' && 'leftAt' in stands ? stands.leftAt : sizeAtRest;
    if (outcome.kind === 'failed' && outcome.fault === 'tookTooLong') {
      onCodeTookTooLong();
      return setDrawing({
        nth: nth + 1,
        stands: 'onItsWay',
      });
    }
    setDrawing({
      nth,
      stands:
        outcome.kind === 'drawn'
          ? 'drawn'
          : {
              fault: outcome.fault,
              inputs: inputsOfOutcome,
              size,
            },
    });
    if (outcome.kind === 'failed' && outcome.fault === 'tookCaret') onCodeTookCaret();
    return;
  };
  let cellsProblem = React.useMemo(() => chartCellsProblem(inputs), [inputs]);
  const cameOut = cellsProblem !== null || (typeof stands === 'object' && 'fault' in stands) ? 'failed' : stands === 'drawn' ? 'drawn' : null;
  React.useEffect(() => {
    if (cameOut !== null) onCameOut?.(cameOut);
  }, [cameOut, onCameOut]);
  const hasFailed = typeof stands === 'object' && 'fault' in stands;
  let isLastingFault = hasFailed && !RETRIED_CHART_FAULTS.has(stands.fault);
  if (cellsProblem !== null && !isLastingFault) {
    if (stands === 'drawn')
      setDrawing({
        nth: nth + 1,
        stands: 'onItsWay',
      });
    return <ChartCellsProblemNotice why={cellsProblem} name={name} />;
  }
  if (hasFailed) {
    let hasSizeChanged = sizeAtRest !== null && stands.size !== sizeAtRest;
    if (RETRIED_CHART_FAULTS.has(stands.fault) && (stands.inputs !== inputs || hasSizeChanged))
      setDrawing({
        nth: nth + 1,
        stands: 'onItsWay',
      });
    return <ChartCantBeShownNotice why={chartProblemOfFault(stands.fault)} ofCode={artifact} />;
  }
  if (typeof window < 'u' && !stripFrameTimestampParams())
    return <ChartCantBeShownNotice why="notLoaded" />;
  return <><ChartFrame key={nth} frameDocument={frameDocument} artifact={artifact} inputs={inputs} name={name} isOnShow={stands === 'drawn'} tellsOfPointer={tellsOfPointer} onTold={onTold} onLeaving={() =>
            setDrawing({
              nth,
              stands: {
                leftAt: sizeAtRest,
              },
            })} onCaretTaken={onCaretTaken} />{stands === 'drawn'
        ? <NoChartNotice />
        : <ChartOnItsWay comesAtOnce={takesOverFromSkeleton} />}</>;
}
export function typeIntoAskBox(key: string, isCharacter: boolean, words: string): Pick<ChartAsk, 'words'> | 'shut' | 'nothing' {
  if (isCharacter)
    return {
      words: `${words}${key}`.slice(0, mostAskWordsTyped()),
    };
  let lastSegment = [...new Intl.Segmenter().segment(words)].at(-1);
  if (key === 'Backspace')
    return {
      words: words.slice(0, lastSegment?.index ?? 0),
    };
  return key === 'Escape' ? 'shut' : 'nothing';
}
/** What the page gives every placed view, through the layer. */
interface PlacedViewsOfPage {
  body: PaneRect;
  zoom: number;
  runsOn: ChartsRunOn;
  hearPresses: ReturnType<typeof createChartTapTracker>['hear'];
  onAct: (placementId: string, act: PlacedViewAct) => void;
  onAskAgent: ((viewId: string) => void) | null;
  doesChatTakeWords: boolean;
  onSendToAgent: SendToAgentAboutView;
  onFixAsked: SendToAgentAboutView | null;
  onNoticeWithFixCame: () => boolean;
  isKeyOfMenu: (event: React.KeyboardEvent<HTMLElement>) => boolean;
  onCaret: (placementId: string, how: 'come' | 'left', otherEnd: CaretOtherEnd) => void;
  onSidesPressed: NonNullable<SelectionFrameProps['onResizeStart']>;
  onCaretTaken: () => void;
}
interface PlacedViewProps extends PlacedViewsOfPage {
  placedView: PlacedViewToDraw;
  isRun: boolean;
  isUnderMouse: boolean;
  onMouseIsOver: (placementId: string, isOver: boolean) => void;
  tap: TapOnPlacedView | null;
  changes: ChartEditsByAgent | null;
  ask: ChartAsk;
  onAskChanged: (viewId: string, update: UpdateOfChartAsk) => void;
  actThatOpenedCard: number | null;
  isCardOpenedLate: boolean;
  onCardOpenChange: (placementId: string, isOpen: boolean, isHeardLate?: boolean) => void;
  onCaretOfCardSettled: () => void;
  isCaretOfCardOwed: () => boolean;
  onSteppedBackFromChange: (viewId: string) => void;
  onPageCannotAsk: () => void;
  canAgentWrite: boolean;
  onKeepPressed: (viewId: string, change: ChartChange | null) => boolean;
  onPreviewCameOut: (viewId: string, cameOut: ChartCameOut) => void;
  lastBlurOfWindowAtMs: () => number;
}
/** The kind of the chart a node draws, once read. */
interface KindOfShownChart {
  nodeId: string | null;
  kind: StockKind | null;
}
export function PlacedView({
  placedView: {
    placementId,
    viewId,
    name,
    caption,
    box,
    isInView,
    chart,
    isSelected,
    canBeChanged,
    doesMouseBringTools,
    isHeld,
    isHeldOnTheSpot,
    askBoxStands,
  },
  isRun,
  isUnderMouse,
  onMouseIsOver,
  body,
  zoom,
  runsOn,
  tap,
  hearPresses,
  onAct,
  onAskAgent,
  doesChatTakeWords,
  onSendToAgent,
  onFixAsked,
  onNoticeWithFixCame,
  changes,
  isKeyOfMenu,
  ask,
  onAskChanged,
  actThatOpenedCard,
  isCardOpenedLate,
  onCardOpenChange,
  onCaretOfCardSettled,
  isCaretOfCardOwed,
  onSteppedBackFromChange,
  onPageCannotAsk,
  canAgentWrite = false,
  onKeepPressed,
  onPreviewCameOut,
  lastBlurOfWindowAtMs,
  onCaret,
  onSidesPressed,
  onCaretTaken,
}: PlacedViewProps) {
  let pointerOfShownRef = React.useRef<PointerToChartFrame>(null);
  let pointerOfPreviewRef = React.useRef<PointerToChartFrame>(null);
  let firstPointerAtRef = React.useRef<PointAt | null>(null);
  let onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return;
    let { x: firstX, y: firstY } = firstPointerAtRef.current ?? {
      x: event.screenX,
      y: event.screenY,
    };
    firstPointerAtRef.current ??= {
      x: firstX,
      y: firstY,
    };
    let hasMouseMoved = event.screenX !== firstX || event.screenY !== firstY;
    if (event.pointerType === 'mouse' && hasMouseMoved && !isUnderMouse) onMouseIsOver(placementId, true);
    if (isInPlacedViewAskBox(event.target)) return pointerOfShownRef.current?.isAt(null);
    let { left, top: topEdge } = event.currentTarget.getBoundingClientRect();
    let pointerAt = {
      x: (event.clientX - left) / zoom,
      y: (event.clientY - topEdge) / zoom,
    };
    pointerOfShownRef.current?.isAt(isHeld ? null : pointerAt);
  };
  let tellPointerAt = React.useEffectEvent((at: PointAt | null) => pointerOfShownRef.current?.isAt(at));
  React.useEffect(
    () => hearPresses(placementId, (at) => pointerOfShownRef.current?.hasPressedAt(at)),
    [hearPresses, placementId],
  );
  let lastTapRef = React.useRef<TapOnPlacedView | null>(null);
  React.useEffect(() => {
    if (tap === null || tap === lastTapRef.current || !isSelected || isHeld) return;
    lastTapRef.current = tap;
    tellPointerAt({
      x: tap.x,
      y: tap.y,
    });
    return () => tellPointerAt(null);
  }, [tap, isSelected, isHeld]);
  let [isCaretInAskBox, setIsCaretInAskBox] = React.useState(false);
  if (!isSelected && isCaretInAskBox) setIsCaretInAskBox(false);
  let onViewFocus = ({ target, relatedTarget }: React.FocusEvent<HTMLDivElement>) => {
    setIsCaretInAskBox(isInPlacedViewAskBox(target));
    if (actThatOpenedCard !== null && !isInPlacedViewCardOrTools(target) && !isCaretOfCardOwed()) onCardOpenChange(placementId, false);
    onCaret(placementId, 'come', relatedTarget ?? 'onNothing');
  };
  let onViewBlur = ({ relatedTarget, currentTarget, target }: React.FocusEvent<HTMLDivElement>) => {
    if (currentTarget.contains(relatedTarget)) return;
    setIsCaretInAskBox(false);
    if (relatedTarget !== null) onCaret(placementId, 'left', relatedTarget);
    else
      whenBlurredToNothingChecked(
        target,
        (isWindowFocused) => onCaret(placementId, 'left', isWindowFocused ? 'onNothing' : 'outOfWindow'),
      );
  };
  let selectionFrame = {
    x: 0,
    y: 0,
    w: box.width,
    h: box.height,
  };
  let cornerStyle = {
    borderRadius: `calc(var(--sheet-radius-of-chart) * ${String(zoom)})`,
  };
  let { showsIn } = box;
  let canAskChange = React.useMemo(() => canAskChartChange(changes, chart, canAgentWrite), [changes, chart, canAgentWrite]);
  let shownNodeOfChart = chart.kind === 'none' ? null : shownChartNode(chart.nodeId, ask.change ?? null);
  let [kindOfShown, setKindOfShown] = React.useState<KindOfShownChart>({
    nodeId: null,
    kind: null,
  });
  React.useEffect(() => {
    if (!isSelected || changes === null || shownNodeOfChart === null || kindOfShown.nodeId === shownNodeOfChart) return;
    let isLive = true;
    changes
      .kindOf(shownNodeOfChart)
      .catch(() => null)
      .then((kind) =>
        isLive
          ? setKindOfShown({
              nodeId: shownNodeOfChart,
              kind,
            })
          : undefined,
      );
    return () => {
      isLive = false;
    };
  }, [isSelected, changes, shownNodeOfChart, kindOfShown.nodeId]);
  let changeOffers = React.useMemo(
    () => chartChangeOffers(chart, kindOfShown.nodeId === shownNodeOfChart ? kindOfShown.kind : null, canAgentWrite),
    [chart, kindOfShown, shownNodeOfChart, canAgentWrite],
  );
  let isCardOffered = (doesChatTakeWords || canAskChange) && askBoxStands?.isRoomEnough === true;
  let isCardOpen = actThatOpenedCard !== null;
  const isCardShown = askBoxStands !== null && isCardOpen;
  let showsEditButton = (onAskAgent !== null || isCardOffered || isCardOpen) && box.width >= PLACED_VIEW_TOOLS_WITH_EDIT_PX;
  let toolsCutOffRight = clampToolsCutOff(
    box.left + box.width - showsIn.left - showsIn.width,
    box.width,
    showsEditButton ? PLACED_VIEW_TOOLS_WITH_EDIT_PX : PLACED_VIEW_TOOLS_MIN_PX,
  );
  let showsTools = canBeChanged;
  let areToolsShown = (isSelected || (isUnderMouse && doesMouseBringTools)) && (!isHeld || isHeldOnTheSpot);
  let hasSmallTools = !useAnyCoarsePointer();
  let smallButtonProps: Pick<ButtonProps, 'size'> = hasSmallTools
    ? {
        size: 'xs',
      }
    : {};
  let toolsTabIndex = isSelected ? 0 : -1;
  let [viewRef, toolsFocusHandlers] = useFocusFallbackToButton(showsEditButton || !showsTools, FOCUS_WITHOUT_SCROLL);
  let sendToAgent = React.useCallback((words: string) => onSendToAgent(viewId, words), [onSendToAgent, viewId]);
  let focusChart = React.useCallback(() => {
    let ownerDocument = viewRef.current?.ownerDocument;
    if (ownerDocument !== undefined) findPlacedViewCaret(ownerDocument, placementId)?.focus(FOCUS_WITHOUT_SCROLL);
  }, [viewRef, placementId]);
  let canBeFixed = canBeChanged && isViewBigEnoughForFix(box);
  let wasNoticeHeardRef = React.useRef(false);
  let fixNoticeContext = React.useMemo<PlacedViewFix>(
    () => ({
      noticeCame: (hasFixButton) => {
        if (canBeFixed && !wasNoticeHeardRef.current) wasNoticeHeardRef.current = hasFixButton || onNoticeWithFixCame();
      },
      ask: canBeFixed && onFixAsked !== null ? (words: string) => onFixAsked(viewId, words) : null,
      giveChartCaret: focusChart,
    }),
    [canBeFixed, onNoticeWithFixCame, onFixAsked, viewId, focusChart],
  );
  let keyedEditButtonRef = React.useRef<HTMLElement | null>(null);
  let settledActRef = React.useRef(actThatOpenedCard);
  let shutCard = () => onCardOpenChange(placementId, false);
  let { isShut: isCardShut, noteFocus: noteCardFocus } = useShutOnWindowBlur(isCardShown, shutCard);
  let settleCardCaret = React.useEffectEvent(() => {
    settledActRef.current = actThatOpenedCard;
    onCaretOfCardSettled();
    let ownerDocument = viewRef.current?.ownerDocument;
    if (ownerDocument === undefined) return;
    if (isCardOpenedLate && !ownerDocument.hasFocus()) return shutCard();
    const activeElement = ownerDocument.activeElement;
    const wasEditKeyed =
      activeElement instanceof HTMLElement &&
      activeElement.closest(`.${PLACED_VIEW_TOOLS_CLASS}`) !== null &&
      activeElement.matches(':focus-visible');
    keyedEditButtonRef.current = wasEditKeyed ? activeElement : null;
    let askInput = findPlacedViewAskInput(ownerDocument, placementId);
    askInput?.focus(FOCUS_WITHOUT_SCROLL);
    if (askInput instanceof HTMLInputElement) askInput.setSelectionRange(askInput.value.length, askInput.value.length);
    return;
  });
  React.useLayoutEffect(() => {
    if (!isCardShown || !isNewCardAct(actThatOpenedCard, settledActRef.current)) return;
    if (!isCardOpenedLate) return settleCardCaret();
    let isCancelled = false;
    waitForNextTask().then(() => (isCancelled ? undefined : settleCardCaret()));
    return () => {
      isCancelled = true;
    };
  }, [isCardShown, actThatOpenedCard, isCardOpenedLate]);
  let closeCard = () => {
    let [view, keyedEditButton] = [viewRef.current, keyedEditButtonRef.current];
    let activeElement = view?.ownerDocument.activeElement ?? null;
    let caretGoes = whereCaretGoesAfterCard({
      hasWindowKeyboard: view?.ownerDocument.hasFocus() === true,
      isCaretAtCardOrTools: view?.contains(activeElement) === true && isInPlacedViewCardOrTools(activeElement),
      wasPencilPressedByKey: keyedEditButton !== null && view?.contains(keyedEditButton) === true,
    });
    if (caretGoes === 'toPencil') keyedEditButton?.focus(FOCUS_WITHOUT_SCROLL);
    if (caretGoes === 'toChart') focusChart();
    onCardOpenChange(placementId, false);
  };
  let change = ask.change ?? null;
  let shownNodeId = chart.kind === 'none' ? null : shownChartNode(chart.nodeId, change);
  React.useEffect(() => {
    if (shownNodeId !== null) pointerOfPreviewRef.current?.isAt(null);
  }, [shownNodeId]);
  let onEditPressed = (event: React.MouseEvent<HTMLButtonElement>) => {
    let { detail, currentTarget, nativeEvent } = event;
    let nowMs = performance.now();
    let hasWindowFocus = currentTarget.ownerDocument.hasFocus();
    let isByKey = detail === 0;
    let isWindowLeft = isByKey
      ? !hasWindowFocus
      : !isPressFromThisWindow({
          hasWindowFocus,
          madeAtMs: nativeEvent.timeStamp,
          nowMs,
          lastBlurAtMs: lastBlurOfWindowAtMs(),
        });
    if (isWindowLeft) event.stopPropagation();
    let act = editButtonAct({
      isWindowLeft,
      isKeyBeforeCardHasCaret: isByKey && isCaretOfCardOwed(),
      isCardOpen,
      isCardOffered,
    });
    if (act === 'shutsCard') closeCard();
    if (act === 'attachesChart') onAskAgent?.(viewId);
    if (act === 'opensCard') onCardOpenChange(placementId, true, isByKey || (hasWindowFocus && isLateEvent(nativeEvent.timeStamp, nowMs)));
  };
  let latestAskRef = React.useRef({
    act: actThatOpenedCard,
    words: ask.words,
  });
  React.useLayoutEffect(() => {
    latestAskRef.current = {
      act: actThatOpenedCard,
      words: ask.words,
    };
  });
  let isChatToBeHad = doesChatTakeWords || onAskAgent !== null;
  let onAsked = (kind: ChartKindOrAny, words: string) => {
    let askWords = askWordsOfKind(kind, words);
    if (cleanAskWords(askWords) === '') return;
    let isKindSwap =
      kind !== 'any' && cleanAskWords(words) === '' && chart.kind !== 'none' && canSwapChartKind(chart.inputs, kind);
    let canChangeHere = canAskChange && (isKindSwap || canAgentWrite);
    let goesToChat = !isKindSwap && shouldAskInChatInstead(ask.whyNotChanged ?? null, isChatToBeHad);
    if (!canChangeHere && !isChatToBeHad)
      return onAskChanged(
        viewId,
        () => ({
          whyNotChanged: 'noAgent',
        }),
      );
    if (goesToChat && !doesChatTakeWords && onAskAgent !== null) {
      closeCard();
      onAskAgent(viewId);
      return;
    }
    if (canChangeHere && !goesToChat && changes !== null && chart.kind !== 'none') {
      const asked: AskedChartChange = {
        stands: 'asked',
        from: shownChartNode(chart.nodeId, change),
      };
      let isAskedByRow = kind !== 'any';
      onAskChanged(
        viewId,
        (current) => ({
          ...chartChangeAsked(current, asked, askWords),
          became: null,
          wasAskedByRow: isAskedByRow,
        }),
      );
      changes
        .ask(
          {
            nodeId: asked.from,
            inputs: chart.inputs,
          },
          askWords,
          MAX_ASK_WORDS_LENGTH,
          kind !== 'any' && cleanAskWords(words) === '' ? kind : null,
        )
        .then(
          (outcome) => (
            onAskChanged(viewId, (current) => chartChangeAnswered(current, asked, outcome)),
            outcome === 'noAgent' ? onPageCannotAsk() : undefined
          ),
        );
      return;
    }
    onAskChanged(
      viewId,
      () => ({
        isOnItsWay: true,
        became: null,
        whyNotChanged: null,
      }),
    );
    sendToAgent(askWords).then((became) => {
      let isSameAsk = latestAskRef.current.act === actThatOpenedCard && latestAskRef.current.words === words;
      onAskChanged(viewId, (current) => askAfterSent(current, words, became));
      let hasCaret = isSameAsk && viewRef.current?.ownerDocument.hasFocus() === true;
      if (!isAskTaken(became) && !isInView && hasCaret) onCaret(placementId, 'come', 'onNothing');
      return became === 'taken' && isSameAsk ? closeCard() : undefined;
    });
  };
  let lastKeyRef = React.useRef<KeyInAskBox>({
    atMs: Number.NEGATIVE_INFINITY,
    wasHeld: false,
  });
  let onPreviewOutcome = React.useCallback((cameOut: ChartCameOut) => onPreviewCameOut(viewId, cameOut), [onPreviewCameOut, viewId]);
  let onChangeKept = () => {
    if (onKeepPressed(viewId, change)) closeCard();
  };
  let refusal =
    (ask.whyNotChanged ?? null) === null
      ? null
      : chartAskFaultShown(ask.whyNotChanged ?? 'notChanged', {
          wasByRow: ask.wasAskedByRow === true,
          isChatToBeHad,
        });
  let noteOnLastAsk =
    refusal !== null ? chartChangeRefusalWords(refusal, doesChatTakeWords) : ask.became === null ? null : askSentToChatWords(ask.became);
  let takesChartCaret = isSelected && isCaretInAskBox && askBoxStands === null;
  React.useEffect(() => {
    let ownerDocument = viewRef.current?.ownerDocument;
    if (takesChartCaret && ownerDocument?.activeElement === ownerDocument?.body && ownerDocument?.hasFocus() === true) focusChart();
  }, [takesChartCaret, viewRef, focusChart]);
  let toolsCutOffStyle: StyleWithCustomProperties = {
    '--sheet-middle-of-title': `${String(middleOfChartTitle(box))}px`,
    '--sheet-cut-off-right': `${String(toolsCutOffRight)}px`,
    '--sheet-cut-off-top': `${String(clampToolsCutOff(showsIn.top - box.top, box.height, PLACED_VIEW_TOOLS_MIN_PX))}px`,
  };
  let describedBy = [
    placedViewDrawingId(placementId),
    ...(caption === '' ? [] : [placedViewCaptionId(placementId)]),
    ...(canBeChanged ? [PLACED_VIEW_KEYS_HINT_ID] : []),
    ...(isCardOffered ? [PLACED_VIEW_TYPING_HINT_ID] : []),
  ];
  return <div className="sheet-room-of-placed-view" data-is-on-top={isSelected} style={{
      left: body.left + box.showsIn.left,
      top: body.top + box.showsIn.top,
      width: box.showsIn.width,
      height: box.showsIn.height,
    }}><div ref={viewRef} {...{
        [PLACEMENT_ID_ATTRIBUTE]: placementId,
      }} className="sheet-placed-view group" role="presentation" data-is-in-view={isInView} data-is-held={isHeld} style={{
        left: isInView ? box.left - box.showsIn.left : 0,
        top: isInView ? box.top - box.showsIn.top : 0,
        width: box.width,
        height: box.height,
      }} onFocus={onViewFocus} onBlur={onViewBlur} onPointerMove={onPointerMove} onPointerLeave={({ pointerType }) => {
        firstPointerAtRef.current = null;
        onMouseIsOver(placementId, false);
        if (pointerType !== 'touch' || tap === null) pointerOfShownRef.current?.isAt(null);
      }}>{caption !== '' &&
          <span id={placedViewCaptionId(placementId)} hidden>{caption}</span>}<button type="button" id={placedViewCaretId(placementId)} className={PLACED_VIEW_CARET_CLASS} tabIndex={0} aria-label={chartMessages.chartNamed(name)} aria-describedby={describedBy.join(' ')} onClick={({ currentTarget }) =>
            currentTarget.focus({
              preventScroll: true,
            })} /><Surface elevation="panel" className="sheet-ground-of-chart size-full"><div id={placedViewDrawingId(placementId)} className="sheet-chart"><ChartNoticeScope id={placementId}><PlacedViewFixContext value={fixNoticeContext}>{!isRun
                  ? null
                  : chart.kind === 'none'
                    ? <ChartCantBeShownNotice why={chart.why === 'tooMuchToRead' ? 'tooMuchData' : 'cantBeShown'} />
                    : chartNodesToDraw(chart.nodeId, change).map((nodeId) => {
                        let isShownNode = nodeId === shownChartNode(chart.nodeId, change);
                        return (<div key={nodeId} className={`absolute inset-0 ${isShownNode ? '' : 'invisible'}`}><ChartNoticeGate isHeardOf={isShownChartNodeSettled(nodeId, chart.nodeId, change)}><PlacedChart runsOn={runsOn} nodeId={nodeId} {...(nodeId !== chart.nodeId && {
                                  onCameOut: onPreviewOutcome,
                                })} inputs={chart.inputs} sizeAtRest={isHeld ? null : `${String(box.width)} ${String(box.height)}`} name={name} tellsOfPointer={isShownNode ? pointerOfShownRef : pointerOfPreviewRef} onCaretTaken={onCaretTaken} /></ChartNoticeGate></div>);
                      })}</PlacedViewFixContext></ChartNoticeScope></div></Surface>{isSelected
          ? (<SelectionFrame frame={selectionFrame} scale={zoom} style={cornerStyle} {...(canBeChanged
                ? {
                    onResizeStart: onSidesPressed,
                  }
                : {
                    grips: 'none',
                  })} />)
          : canBeChanged &&
            <SelectionFrame frame={selectionFrame} scale={zoom} state="hover" style={cornerStyle} className="hidden group-hover:block" />}{showsTools &&
          (<div className={`${PLACED_VIEW_TOOLS_CLASS} flex gap-0.5 pointer-coarse:gap-2`} data-are-small={hasSmallTools} data-are-shown={areToolsShown} data-is-under-mouse={isUnderMouse} aria-hidden={!isSelected} style={toolsCutOffStyle} onClickCapture={(event) => {
              if (event.detail > 1) event.stopPropagation();
            }}><TooltipGroup>{showsEditButton &&
                  (<Button variant="ghost" iconOnly icon="Edit" {...smallButtonProps} aria-label={chartMessages.editWithAgent()} {...((isCardOffered || isCardOpen) && {
                      pressed: isCardOpen,
                    })} {...(isCardShown && {
                      'aria-controls': placedViewCardId(placementId),
                    })} tabIndex={toolsTabIndex} onClick={onEditPressed} {...toolsFocusHandlers} />)}<Button variant="ghost" iconOnly icon="Trash" {...smallButtonProps} tabIndex={toolsTabIndex} aria-label={chartMessages.deleteChart()} onClick={({ detail }) =>
                    onAct(placementId, {
                      kind: 'delete',
                      isByKey: detail === 0,
                    })} /></TooltipGroup></div>)}{isSelected &&
          isCardShown &&
          !isCardShut &&
          (<div id={placedViewCardId(placementId)} role="presentation" className={PLACED_VIEW_ASK_BOX_CLASS} style={{
              left: isInView ? askBoxStands.left : 0,
              top: isInView ? askBoxStands.top : 0,
              width: askBoxStands.width * zoom,
              scale: 1 / zoom,
            }} data-is-hidden={isHeld} onKeyDownCapture={(event) => {
              let isHeldKey =
                event.key === 'Enter' &&
                change?.stands === 'waits' &&
                shouldHoldEnterOnChange({
                  isChartInView: isInView,
                  pressedAtMs: event.timeStamp,
                  lastBlurOfWindowAtMs: lastBlurOfWindowAtMs(),
                  lastAct: lastKeyRef.current,
                });
              lastKeyRef.current = {
                atMs: event.timeStamp,
                wasHeld: isHeldKey,
              };
              if (!isInView && (event.key !== 'Enter' || isHeldKey)) onCaret(placementId, 'come', event.target);
              if (!isHeldKey) return;
              event.preventDefault();
              event.stopPropagation();
            }} onKeyDown={(event) => {
              if (chartChangeStage(change) !== null) cycleTabFocusForward(event);
              if (event.key !== 'Escape' || isKeyOfMenu(event)) return;
              if (change?.stands === 'waits') onSteppedBackFromChange(viewId);
              else closeCard();
            }} onPointerDownCapture={({ timeStamp }) => {
              lastKeyRef.current = {
                atMs: timeStamp,
                wasHeld: false,
              };
            }} onFocus={noteCardFocus} onBlur={({ relatedTarget, currentTarget }) => {
              if (relatedTarget === null || currentTarget.contains(relatedTarget)) return;
              if (!isInPlacedViewCardOrTools(relatedTarget)) onCardOpenChange(placementId, false);
            }}><Surface elevation="popover"><div className="overflow-hidden rounded-[inherit]"><ChartAskMenu changesChart onOffer={changeOffers} whyNot={ask.isOnItsWay ? 'waiting' : !canAgentWrite && !isChatToBeHad ? 'noChat' : null} canPageMakeChart={changeOffers.some(({ isSwap }) => isSwap)} change={chartChangeStage(change)} askedOfAgent={ask.asked ?? ''} isKindAsked={ask.wasAskedByRow === true} onChangeKept={onChangeKept} onSteppedBackFromChange={() => onSteppedBackFromChange(viewId)} noteOnLastAsk={ask.became === 'taken' ? null : noteOnLastAsk} mostTyped={mostAskWordsTyped()} typed={ask.words} onTyped={(words) =>
                    onAskChanged(
                      viewId,
                      () => ({
                        words,
                        whyNotChanged: null,
                      }),
                    )} isNoteOfFault={refusal !== 'forChat' && refusal !== 'notHere'} isKeyOfAnother={(event) => isKeyOfMenu(event) || (change?.stands === 'waits' && event.key === 'Escape')} onAsked={onAsked} /></div></Surface></div>)}{isSelected &&
          <LiveAnnouncer words={noteOnLastAsk} />}</div></div>;
}
interface PlacedViewsLayerProps extends PlacedViewsOfPage {
  placedViews: readonly PlacedViewToDraw[];
  chartBeingMade: ChartBeingMadeShown | null;
  sheetOnShow: SheetId | null;
  onChartBeingMadeGone: (nth: number) => void;
  tap: TapOnPlacedView | null;
  onCardOpened: () => void;
  cardUnderChart: React.Ref<CardUnderChart>;
  /** Draws what is said once the page is at rest, about a subject that keeps it from being said twice. */
  saidAtRest: (words: string | null, about: string) => React.ReactNode;
  changes: ChartEditsByAgent | null;
  pointChart: AskForEditOfChart;
  onKeepAnswered: (pointing: ChartNodeSwap, pointed: ChartChangeOutcome) => void;
}
/** The card under a chart that is open: its placement, the act that opened it, and whether it was opened late. */
interface OpenCardUnderChart {
  placementId: string;
  act: number;
  isHeardLate: boolean;
}
export function PlacedViewsLayer({
  placedViews,
  chartBeingMade,
  sheetOnShow,
  onChartBeingMadeGone,
  tap,
  onCardOpened,
  cardUnderChart,
  saidAtRest,
  ...rest
}: PlacedViewsLayerProps) {
  let [placesToldOf, setPlacesToldOf] = React.useState(NO_PLACES_TOLD_OF);
  let notePlaceToldOf = React.useCallback(
    (placementId: string) =>
      setPlacesToldOf((told) => (told.has(placementId) ? told : new Set(told).add(placementId))),
    [],
  );
  let [runOrder, setRunOrder] = React.useState<string[]>([]);
  let inViewIds = placedViews.flatMap(({ placementId, isInView }) => (isInView ? placementId : []));
  let placementIds = new Set(placedViews.map(({ placementId }) => placementId));
  let runIds = [
    ...inViewIds,
    ...runOrder.filter((placementId) => placementIds.has(placementId) && !inViewIds.includes(placementId)),
  ].slice(0, Math.max(inViewIds.length, MOST_CHARTS_RUN));
  if (runIds.length !== runOrder.length || runIds.some((placementId, index) => placementId !== runOrder[index]))
    setRunOrder(runIds);
  let [asks, setAsks] = React.useState<Readonly<Record<string, ChartAsk>>>({});
  let changeAsk = React.useCallback(
    (viewId: string, update: UpdateOfChartAsk) =>
      setAsks((current) => {
        let ask = current[viewId] ?? EMPTY_CHART_ASK;
        return {
          ...current,
          [viewId]: {
            ...ask,
            ...update(ask),
          },
        };
      }),
    [],
  );
  let [openCard, setOpenCard] = React.useState<OpenCardUnderChart | null>(null);
  let cardActsRef = React.useRef(0);
  let isCaretOfCardOwedRef = React.useRef(false);
  let settleCardCaret = React.useCallback(() => {
    isCaretOfCardOwedRef.current = false;
  }, []);
  let isCaretOfCardOwed = React.useCallback(() => isCaretOfCardOwedRef.current, []);
  let lastBlurAtRef = React.useRef(Number.NEGATIVE_INFINITY);
  let lastBlurOfWindowAtMs = React.useCallback(() => lastBlurAtRef.current, []);
  let [layerElement, setLayerElement] = React.useState<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const view = layerElement?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    let onBlur = () => {
      lastBlurAtRef.current = view.performance.now();
    };
    view.addEventListener('blur', onBlur);
    return () => view.removeEventListener('blur', onBlur);
  }, [layerElement]);
  let setCardOpen = (placementId: string, isOpen: boolean, isHeardLate = true) => {
    let viewId = placedViews.find((placedView) => placedView.placementId === placementId)?.viewId;
    if (viewId !== undefined)
      changeAsk(
        viewId,
        ({ became }) => ({
          became: becameAfterCardChange(became, isOpen),
          ...(isOpen && {
            whyNotChanged: null,
          }),
        }),
      );
    if (isOpen || openCard?.placementId === placementId) isCaretOfCardOwedRef.current = isOpen;
    if (!isOpen) return setOpenCard((current) => (current?.placementId === placementId ? null : current));
    cardActsRef.current += 1;
    setOpenCard({
      placementId,
      act: cardActsRef.current,
      isHeardLate,
    });
    return onCardOpened();
  };
  let [placementUnderMouse, setPlacementUnderMouse] = React.useState<string | null>(null);
  let noteMouseIsOver = React.useCallback(
    (placementId: string, isOver: boolean) =>
      setPlacementUnderMouse((current) => (isOver ? placementId : current === placementId ? null : current)),
    [],
  );
  if (placementUnderMouse !== null && !placedViews.some(({ placementId }) => placementId === placementUnderMouse))
    setPlacementUnderMouse(null);
  let { changes, pointChart, onKeepAnswered } = rest;
  let [canHaveChanges, setCanHaveChanges] = React.useState(false);
  let isAnySelected = placedViews.some(
    ({ isSelected, placementId }) => isSelected || placementId === placementUnderMouse,
  );
  React.useEffect(() => {
    if (!isAnySelected || changes === null) return;
    let isLive = true;
    changes
      .isToBeHad()
      .catch(() => false)
      .then((canHave) => (isLive ? setCanHaveChanges(canHave) : undefined));
    return () => {
      isLive = false;
    };
  }, [isAnySelected, changes]);
  let [canAgentChangeCharts, setCanAgentChangeCharts] = React.useState(false);
  React.useEffect(() => {
    if (!isAnySelected || changes === null) return;
    let isLive = true;
    changes
      .canAskAgent()
      .catch(() => false)
      .then((canAsk) => (isLive ? setCanAgentChangeCharts(canAsk) : undefined));
    return () => {
      isLive = false;
    };
  }, [isAnySelected, changes]);
  let [isPageUnableToAsk, setIsPageUnableToAsk] = React.useState(false);
  let changesNow = canHaveChanges ? changes : null;
  let canAgentWrite = canAgentChangeCharts && !isPageUnableToAsk;
  let stepBackFromChange = (viewId: string) => changeAsk(viewId, letGoOfChartChange);
  let asksRef = React.useRef(asks);
  React.useLayoutEffect(() => {
    asksRef.current = asks;
  });
  let keepChange = (viewId: string, kept: ChartChange | null) => (
    ReactDOM.flushSync(
      () =>
        changeAsk(viewId, (ask) => {
          let next = chartChangeKept(ask, kept);
          return next.change === undefined
            ? next
            : {
                ...next,
                words: '',
              };
        }),
    ),
    asksRef.current[viewId]?.change?.stands === 'kept'
  );
  let onPreviewCameOut = React.useCallback(
    (viewId: string, cameOut: ChartCameOut) => changeAsk(viewId, (ask) => chartChangeDrawn(ask, cameOut)),
    [changeAsk],
  );
  let notePageCannotAsk = () => setIsPageUnableToAsk(true);
  let isCardAskable = (placedView: PlacedViewToDraw) =>
    (rest.doesChatTakeWords || canAskChartChange(changesNow, placedView.chart, canAgentWrite)) &&
    placedView.askBoxStands?.isRoomEnough === true;
  let askableViewOf = (placementId: string) => {
    let placedView = placedViews.find((candidate) => candidate.placementId === placementId);
    return placedView?.isSelected === true && isCardAskable(placedView) ? placedView : null;
  };
  let openCardOf = React.useEffectEvent((placementId: string) => {
    if (askableViewOf(placementId) !== null) setCardOpen(placementId, true);
  });
  let canAgentChange = React.useEffectEvent((placementId: string) => {
    let placedView = placedViews.find((candidate) => candidate.placementId === placementId);
    return placedView?.canBeChanged === true && (rest.onAskAgent !== null || isCardAskable(placedView));
  });
  let isChangeUnderWay = React.useEffectEvent((placementId: string) => {
    let placedView = placedViews.find((candidate) => candidate.placementId === placementId);
    return placedView !== undefined && chartChangeStage(asks[placedView.viewId]?.change ?? null) !== null;
  });
  let editChart = React.useEffectEvent((placementId: string) => {
    if (askableViewOf(placementId) !== null) return setCardOpen(placementId, true);
    let placedView = placedViews.find((candidate) => candidate.placementId === placementId);
    if (placedView !== undefined) rest.onAskAgent?.(placedView.viewId);
  });
  let takeKey = React.useEffectEvent((placementId: string, keyPress: KeyOnPlacedView) => {
    let { key, isCharacter, isOnChartItself, madeAtMs } = keyPress;
    let viewId = placedViews.find((candidate) => candidate.placementId === placementId)?.viewId;
    if (openCard?.placementId === placementId && viewId !== undefined) {
      if (!isCaretOfCardOwedRef.current) return false;
      const typed = typeIntoAskBox(key, isCharacter, asks[viewId]?.words ?? '');
      if (typed === 'shut') ReactDOM.flushSync(() => setCardOpen(placementId, false));
      else if (typed !== 'nothing') ReactDOM.flushSync(() => changeAsk(viewId, () => typed));
      return true;
    }
    if (!isCharacter || key === ' ' || !isOnChartItself) return false;
    let askableView = askableViewOf(placementId);
    if (askableView === null) return false;
    if (layerElement?.ownerDocument.hasFocus() !== true) return true;
    ReactDOM.flushSync(() => {
      changeAsk(
        askableView.viewId,
        () => ({
          words: key,
          became: null,
        }),
      );
      setCardOpen(placementId, true, isLateEvent(madeAtMs, performance.now()));
    });
    return true;
  });
  React.useImperativeHandle(
    cardUnderChart,
    (): CardUnderChart => ({
      open: (placementId) => openCardOf(placementId),
      canAgentChange: (placementId) => canAgentChange(placementId),
      isChangeUnderWay: (placementId) => isChangeUnderWay(placementId),
      edit: (placementId) => editChart(placementId),
      takeKey: (placementId, keyPress) => takeKey(placementId, keyPress),
    }),
    [],
  );
  let selectedViewId = placedViews.find(({ isSelected }) => isSelected)?.viewId ?? null;
  let [lastSelectedViewId, setLastSelectedViewId] = React.useState(selectedViewId);
  if (selectedViewId !== lastSelectedViewId) {
    setLastSelectedViewId(selectedViewId);
    if (lastSelectedViewId !== null && (asks[lastSelectedViewId]?.became ?? null) !== null)
      changeAsk(
        lastSelectedViewId,
        () => ({
          became: null,
        }),
      );
  }
  let openCardView = placedViews.find((placedView) => placedView.placementId === openCard?.placementId);
  if (openCard !== null && !canPlacedViewShowAskBox(openCardView)) {
    setOpenCard(null);
    if (openCardView !== undefined)
      changeAsk(
        openCardView.viewId,
        ({ became }) => ({
          became: becameAfterCardChange(became, false),
        }),
      );
  }
  let openCardViewId = openCard === null ? null : (openCardView?.viewId ?? null);
  for (let [viewId, { change = null }] of Object.entries(asks))
    if (chartChangeStage(change) !== null && viewId !== openCardViewId) stepBackFromChange(viewId);
  for (let { viewId, chart } of placedViews)
    if (chart.kind !== 'none' && isKeptChartChangeOutdated(asks[viewId]?.change ?? null, chart.nodeId))
      changeAsk(
        viewId,
        () => ({
          change: null,
        }),
      );
  let answeredKeeps = Object.entries(asks).flatMap(
    ([viewId, { change = null }]) =>
      change?.stands === 'kept' && change.isAnswered
        ? [
            {
              viewId,
              change,
            },
          ]
        : [],
  );
  let clearAnsweredKeeps = React.useEffectEvent(() => {
    for (let { viewId, change } of answeredKeeps)
      changeAsk(
        viewId,
        (ask) =>
          ask.change === change
            ? {
                change: null,
              }
            : {},
      );
  });
  let answeredKeepIds = answeredKeeps.map(({ viewId }) => viewId).join(' ');
  React.useEffect(() => {
    if (answeredKeepIds === '') return;
    let timer = window.setTimeout(clearAnsweredKeeps, KEPT_CHANGE_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [answeredKeepIds]);
  let settledRef = React.useRef(new Set<ChartChange | string>());
  let settleChanges = React.useEffectEvent((allAsks: Readonly<Record<string, ChartAsk>>) => {
    if (changes === null) return;
    let isFirstTime = (changeOrPreview: ChartChange | string) => {
      if (settledRef.current.has(changeOrPreview)) return false;
      settledRef.current.add(changeOrPreview);
      return true;
    };
    for (let [viewId, { change = null, toDiscard = [] }] of Object.entries(allAsks)) {
      if (change?.stands === 'givenUp' && isFirstTime(change)) changes.giveUp();
      for (let previewToDiscard of toDiscard) if (isFirstTime(previewToDiscard)) changes.discard(previewToDiscard);
      if (change?.stands !== 'kept' || change.isAnswered || !isFirstTime(change)) continue;
      let pointing: ChartNodeSwap = {
        from: change.from,
        to: change.preview,
        pubOfFrom: change.pubOfFrom,
      };
      changes
        .pointAt(viewId, pointing, pointChart)
        .catch((): ChartChangeOutcome => 'unsure')
        .then(
          (pointed) => (
            changeAsk(viewId, (ask) => chartChangeKeptChecked(ask, change, pointed)),
            onKeepAnswered(pointing, pointed)
          ),
        );
    }
  });
  React.useEffect(() => settleChanges(asks), [asks]);
  React.useEffect(
    () => () =>
      settleChanges(
        Object.fromEntries(
          Object.entries(asksRef.current).map(
            ([viewId, ask]) => [
              viewId,
              {
                ...ask,
                ...letGoOfChartChange(ask),
              },
            ],
          ),
        ),
      ),
    [],
  );
  let previewsLetGo = Object.values(asks).reduce((sum, ask) => sum + (ask.previewsLetGo ?? 0), 0);
  let [previewsLetGoSaid, setPreviewsLetGoSaid] = React.useState(0);
  if (Object.values(asks).some(({ change = null }) => chartChangeStage(change) !== null) && previewsLetGoSaid !== previewsLetGo)
    setPreviewsLetGoSaid(previewsLetGo);
  return <ChartNoticesProvider onToldOf={notePlaceToldOf}>{saidAtRest(previewsLetGo > previewsLetGoSaid ? chartMessages.previewDiscarded() : null, String(previewsLetGo))}{previewsLetGo > previewsLetGoSaid &&
        <CallWhenNoticeDue key={previewsLetGo} onDue={() => setPreviewsLetGoSaid(previewsLetGo)} />}{placedViews.length > 0 &&
        (<div ref={setLayerElement} className="sheet-placed-views"><span id={PLACED_VIEW_KEYS_HINT_ID} hidden>{chartMessages.keys()}</span><span id={PLACED_VIEW_TYPING_HINT_ID} hidden>{chartMessages.typeToAskAgent()}</span>{placedViews.map(
              (placedView) =>
                <PlacedView key={placedView.placementId} placedView={placedView} isRun={runIds.includes(placedView.placementId)} isUnderMouse={placementUnderMouse === placedView.placementId} onMouseIsOver={noteMouseIsOver} tap={tap?.placementId === placedView.placementId ? tap : null} ask={asks[placedView.viewId] ?? EMPTY_CHART_ASK} onAskChanged={changeAsk} actThatOpenedCard={openCard?.placementId === placedView.placementId ? openCard.act : null} isCardOpenedLate={openCard?.isHeardLate ?? false} onCardOpenChange={setCardOpen} onCaretOfCardSettled={settleCardCaret} isCaretOfCardOwed={isCaretOfCardOwed} onSteppedBackFromChange={stepBackFromChange} onPageCannotAsk={notePageCannotAsk} onKeepPressed={keepChange} onPreviewCameOut={onPreviewCameOut} lastBlurOfWindowAtMs={lastBlurOfWindowAtMs} {...rest} changes={changesNow} canAgentWrite={canAgentWrite} />,
            )}</div>)}<div className="sheet-placed-views"><ChartBeingMade key={sheetOnShow} beingMade={chartBeingMade} body={rest.body} placesToldOf={placesToldOf} onGone={onChartBeingMadeGone} /></div></ChartNoticesProvider>;
}
export const AWAITED_CHART_CODE: ChartCode = {
  kind: 'awaited',
};
export const CHARTS_RUN_ON_NOTHING: ChartsRunOn = {
  code: {
    of: () => AWAITED_CHART_CODE,
    follow: () => () => {
      return;
    },
    tookCaret: () => {
      return;
    },
    tookTooLong: () => {
      return;
    },
  },
  frameDocument: {
    now: () => null,
    follow: () => () => {
      return;
    },
    askAgainIfItDidNotCome: () => {
      return;
    },
  },
};
export const PLACED_VIEW_KEYS_HINT_ID = 'keys-of-floating-chart';
export const PLACED_VIEW_TYPING_HINT_ID = 'typing-on-floating-chart';
export const PLACEMENT_ID_ATTRIBUTE = 'data-placement-id';
export const PLACEMENT_ID_SELECTOR = `[${PLACEMENT_ID_ATTRIBUTE}]`;
export const PLACED_VIEW_CARET_CLASS = 'sheet-caret-of-placed-view';
export const PLACED_VIEW_CARET_SELECTOR = `.${PLACED_VIEW_CARET_CLASS}`;
export const PLACED_VIEW_TOOLS_CLASS = 'sheet-tools-of-placed-view';
export const PLACED_VIEW_ASK_BOX_CLASS = 'sheet-ask-box-of-placed-view';
export const placedViewCaretId = (placementId: string) => `placed-view-${placementId}`;
export const placedViewCaptionId = (placementId: string) => `caption-of-${placedViewCaretId(placementId)}`;
export const placedViewDrawingId = (placementId: string) => `drawing-of-${placedViewCaretId(placementId)}`;
export const placedViewCardId = (placementId: string) => `card-of-${placedViewCaretId(placementId)}`;
export const findPlacedViewCaret = (root: Document, placementId: string) => root.getElementById(placedViewCaretId(placementId));
export const getPlacedViewRect = (root: Document, placementId: string) =>
  findPlacedViewCaret(root, placementId)?.closest(PLACEMENT_ID_SELECTOR)?.getBoundingClientRect() ?? null;
export const placementIdAttributes = (placementId: string) => ({
  [PLACEMENT_ID_ATTRIBUTE]: placementId,
});
export const placementIdOfElement = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest(PLACEMENT_ID_SELECTOR)?.getAttribute(PLACEMENT_ID_ATTRIBUTE) ?? null) : null;
export const doesCaretStayWithPlacement = (placementId: string, caretTarget: CaretGoneTo) =>
  caretTarget === 'outOfWindow' || (caretTarget !== 'onNothing' && caretTarget.partOf === placementId);
export const howCaretComesToPlacedView = ({
  isCaretOfPressOnItsWay,
  hasPageCaret,
  isCaretFreeToGo,
}: CaretToPlacedView) => (isCaretOfPressOnItsWay ? 'comesByItself' : hasPageCaret && isCaretFreeToGo ? 'isBrought' : 'stays');
export const isInPlacedViewAskBox = (target: EventTarget | null) =>
  target instanceof Element && target.closest(`.${PLACED_VIEW_ASK_BOX_CLASS}`) !== null;
export const isInPlacedViewCardOrTools = (target: EventTarget | null) =>
  isInPlacedViewAskBox(target) || (target instanceof Element && target.closest(`.${PLACED_VIEW_TOOLS_CLASS}`) !== null);
export const isInPlacedViewControls = (target: EventTarget | null) =>
  isInPlacedViewCardOrTools(target) || (target instanceof Element && target.closest(`.${FIX_OF_PLACED_VIEW_CLASS}`) !== null);
export const isPlacedViewAskInput = (target: EventTarget | null) => target instanceof HTMLInputElement && isInPlacedViewAskBox(target);
export const findPlacedViewAskInput = (root: Document, placementId: string) =>
  findPlacedViewCaret(root, placementId)?.closest(PLACEMENT_ID_SELECTOR)?.querySelector<HTMLInputElement>(`.${PLACED_VIEW_ASK_BOX_CLASS} input`) ?? null;
export const PLACED_VIEW_TOOLS_MIN_PX = 64;
export const PLACED_VIEW_TOOLS_WITH_EDIT_PX = 104;
export const clampToolsCutOff = (cutOff: number, size: number, keptShown: number) =>
  Math.max(0, Math.min(cutOff, size - keptShown));
export const FOCUS_WITHOUT_SCROLL: FocusOptions = {
  preventScroll: true,
};
export const middleOfChartTitle = ({ width, height }: Pick<PaneRect, 'width' | 'height'>) => 22 / Math.max(1, 320 / width, 200 / height);
export const CHART_NOTICE_OF_MISSING_CODE: Readonly<Record<WhyNoChartCode, ChartProblem>> = {
  notPublished: 'cantBeShown',
  notCompiled: 'cantBeShown',
  notFetched: 'notLoaded',
  tookCaret: 'cantBeShownBeforeReload',
  anotherTookCaret: 'paused',
  tookTooLong: 'cantBeShown',
};
export const RETRIED_CHART_FAULTS: ReadonlySet<ChartFrameFault> = new Set<ChartFrameFault>(['threw', 'inputMissing', 'tooManyRows']);
export const nextTakesOverFromSkeleton = (takesOver: boolean, { isNoticeShown, isAwaited }: ChartCodeLooks) =>
  !isNoticeShown && (isAwaited || takesOver);
export const LAST_DRAWN_CHART_KEPT_MS = 1e4;
export const chartArtifactsToDraw = (artifact: string, lastDrawn: string | null) =>
  lastDrawn === null || lastDrawn === artifact ? [artifact] : [lastDrawn, artifact];
interface PlacedChartProps
  extends Pick<ChartDrawingProps, 'inputs' | 'sizeAtRest' | 'name' | 'tellsOfPointer' | 'onCaretTaken'>,
    Partial<Pick<ChartDrawingProps, 'onCameOut'>> {
  runsOn: ChartsRunOn;
  nodeId: string;
}
export const PlacedChart = React.memo(function ({
  runsOn: { code: codeSource, frameDocument: frameDocumentSource },
  nodeId,
  ...rest
}: PlacedChartProps) {
  let followCode = React.useCallback((onChange: () => void) => codeSource.follow(nodeId, onChange), [codeSource, nodeId]);
  let codeNow = () => codeSource.of(nodeId);
  const code = React.useSyncExternalStore(followCode, codeNow, codeNow);
  let { onCameOut } = rest;
  let missingNodeId = code.kind === 'none' ? nodeId : null;
  React.useEffect(() => {
    if (missingNodeId !== null) onCameOut?.('failed');
  }, [missingNodeId, onCameOut]);
  const frameDocument = React.useSyncExternalStore(frameDocumentSource.follow, frameDocumentSource.now, frameDocumentSource.now);
  const isNoticeShown = code.kind === 'none' || frameDocument === 'notFetched';
  const isAwaited = code.kind === 'awaited' || frameDocument === null;
  let [takesOverFromSkeleton, setTakesOverFromSkeleton] = React.useState(isAwaited);
  let nextTakesOver = nextTakesOverFromSkeleton(takesOverFromSkeleton, {
    isNoticeShown,
    isAwaited,
  });
  if (nextTakesOver !== takesOverFromSkeleton) setTakesOverFromSkeleton(nextTakesOver);
  let artifactNow = isNoticeShown || isAwaited ? null : code.artifact;
  let [lastDrawn, setLastDrawn] = React.useState<string | null>(null);
  let hasLastDrawnStayedLong = useIsTrueForVisibleMs(
    artifactNow !== null && lastDrawn !== null && lastDrawn !== artifactNow,
    LAST_DRAWN_CHART_KEPT_MS,
  );
  if (lastDrawn !== null && (artifactNow === null || hasLastDrawnStayedLong)) setLastDrawn(null);
  let handleCameOut = React.useCallback(
    (cameOut: ChartCameOut) => {
      setTakesOverFromSkeleton(false);
      setLastDrawn(cameOut === 'drawn' ? artifactNow : null);
      onCameOut?.(cameOut);
    },
    [artifactNow, onCameOut],
  );
  let handleLastDrawnCameOut = React.useCallback((cameOut: ChartCameOut) => {
    if (cameOut === 'failed') setLastDrawn(null);
  }, []);
  let pointerNotTold = React.useRef<PointerToChartFrame>(null);
  if (code.kind === 'none')
    return <ChartCantBeShownNotice why={CHART_NOTICE_OF_MISSING_CODE[code.why]} />;
  if (frameDocument === 'notFetched')
    return <ChartCantBeShownNotice why="notLoaded" />;
  if (isAwaited)
    return <ChartOnItsWay comesAtOnce />;
  let artifacts = chartArtifactsToDraw(code.artifact, lastDrawn);
  return <>{artifacts.map((artifact) => {
      let isNow = artifact === code.artifact;
      let isShown = artifacts.length === 1 || !isNow;
      return <div key={artifact} className={`absolute inset-0 ${isShown ? '' : 'invisible'}`}><ChartNoticeGate isHeardOf={isShown}><ChartDrawing frameDocument={frameDocument.text} artifact={artifact} takesOverFromSkeleton={nextTakesOver} onCodeTookCaret={() => codeSource.tookCaret(nodeId)} onCodeTookTooLong={isNow ? () => codeSource.tookTooLong(nodeId) : () => setLastDrawn(null)} {...rest} tellsOfPointer={isShown ? rest.tellsOfPointer : pointerNotTold} onCameOut={isNow ? handleCameOut : handleLastDrawnCameOut} /></ChartNoticeGate></div>;
    })}</>;
});
export const EMPTY_CHART_ASK: ChartAsk = {
  words: '',
  isOnItsWay: false,
  became: null,
};
export const canPlacedViewShowAskBox = (placedView: PlacedViewToDraw | undefined) =>
  placedView?.isSelected === true && placedView.askBoxStands !== null;
export const isNewCardAct = (act: number | null, settledAct: number | null) => act !== null && act !== settledAct;
export const whereCaretGoesAfterCard = (caret: CaretAtCardClose) =>
  !caret.hasWindowKeyboard || !caret.isCaretAtCardOrTools ? 'stays' : caret.wasPencilPressedByKey ? 'toPencil' : 'toChart';
export const becameAfterCardChange = (became: AskSentToChat | null, isOpening: boolean) =>
  (became === 'taken') === isOpening ? null : became;
export const askAfterSent = ({ words }: Pick<ChartAsk, 'words'>, sentWords: string, became: AskSentToChat) => ({
  words: isAskTaken(became) && words === sentWords ? '' : words,
  isOnItsWay: false,
  became,
});
export const LATE_EVENT_MS = 50;
export const isLateEvent = (madeAtMs: number, nowMs: number) => !(nowMs - madeAtMs >= 0 && nowMs - madeAtMs < LATE_EVENT_MS);
export const RECENT_PRESS_MS = 300;
export const isPressFromThisWindow = (press: PressInWindow) =>
  press.hasWindowFocus ||
  (press.nowMs - press.madeAtMs >= 0 && press.nowMs - press.madeAtMs < RECENT_PRESS_MS && press.madeAtMs > press.lastBlurAtMs);
export const editButtonAct = (press: PressOfEditButton) => {
  if (press.isCardOpen) return press.isKeyBeforeCardHasCaret ? 'nothing' : 'shutsCard';
  if (!press.isCardOffered) return 'attachesChart';
  return press.isWindowLeft ? 'nothing' : 'opensCard';
};
export const mostAskWordsTyped = () =>
  MAX_ASK_WORDS_LENGTH -
  1 -
  Math.max(...STOCK_KINDS.map((kind) => makeThisChartKindPrompt(kind).length));
export const askWordsOfKind = (kind: ChartKindOrAny, words: string) =>
  kind === 'any' ? words : [makeThisChartKindPrompt(kind), words.trim()].join(' ').trim();
export const MOST_CHARTS_RUN = 12;
export const KEPT_CHANGE_SHOWN_MS = 3000;
export const NO_PLACES_TOLD_OF: ReadonlySet<string> = new Set<string>();
