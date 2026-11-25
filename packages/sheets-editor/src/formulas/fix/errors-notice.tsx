import { Popover } from '../../kit/popover.tsx';
import { AgentMark } from '../../kit/agent-mark.tsx';
import { Button } from '../../kit/button.tsx';
import * as React from 'react';
import { IS_APPLE_PLATFORM, preventMouseDownDefault } from '../../ui/dom-events.ts';
import { isEntryUntouched } from '../reference-pointing.ts';
import { askAgentToFixSelection } from '../../agent/ask-agent-menu.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { writingFormulasLabel, keepFixesLabel, errorCountLabel } from '../../i18n/grid-action-labels.ts';
import { escapeKeyHint } from '../../messages/formula-writing.ts';
import {
  listRowSize,
  useLastNonNull,
  getLastPointerPoint,
  isWithinPressGuard,
  isPointerStillAt,
  isWithinClickAfterUp,
  withListTabStops,
} from '../../ui/list-under-cell.tsx';
import { OfferRow, OfferWand, RowsThatFold, useOfferPressGuard } from '../from-words/offer-list.tsx';
import { doesKeyStepBackIntoCells } from '../../state/escape.ts';
import { CanTakeFocusContext } from '../../ui/popup-given-up-on-blur.ts';
import { useBottomInset, popupCollisionPadding } from '../../shell/bottom-insets.ts';
import { useActHoldAtAnswer } from '../../agent/answer-holds.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import { agentWritingFixesText, agentWroteFixesText } from '../../i18n/formula-fix-labels.ts';
import { CELL_POPUP_SIDE_OFFSETS } from '../../ui/popup-placement.ts';
import { swallowRestOfPress } from '../../ui/press-swallow.ts';
import { DangerWarningIcon } from '../../ui/warning-icon.tsx';
import type { PopoverPopupProps, PopoverRootProps } from '../../kit/popover.tsx';
import type { PageMode } from '../../state/transitions.ts';
import type { SheetController } from '../../state/controller.ts';
import type { ChatWithAgent } from '../../agent/chat-with-agent.ts';
import type { AnswerHold } from '../../state/initial-state.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { HowActBegan } from '../../format/answer-holds.ts';
import type { WhereFixesShow } from '../../i18n/formula-fix-labels.ts';
import type { OfferListRow, PointerPoint, PressGuardStand } from '../from-words/offer-list.tsx';
import type { FixesBarStage } from './fixes-on-cells.ts';
import type { PressForFixesTracker } from './press-for-fixes.ts';
/** What of the store asks the agent, in the chat, to fix the errors of the selection. */
export type StoreToAskFixes = Pick<SheetController, 'getView' | 'dispatch' | 'isEventUnfinished' | 'errorCountInSelection' | 'errorsToTellOfSelection'>;
/** The stage the notice of errors shows: fixes offered, asked for, or waiting to be kept. */
export type ErrorsNoticeStage = Exclude<FixesBarStage['stage'], 'undecided'>;
/** The stages in which the notice lists the fixes as rows to choose. */
export type FixesUnderWay = Extract<ErrorsNoticeStage, 'asked' | 'waiting'>;
/** What the person does with the fixes: asks for them, keeps them, or ends them. */
export type FixesAct = 'asked' | 'kept' | 'ended';
/** Whether the notice told of errors yet: not yet, now, or already. */
export type ErrorsAnnounceStage = 'notYet' | 'now' | 'already';
/** A key event's modifier keys, from the page or from the browser. */
type KeyWithModifiers = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey'>;
/** Where the errors known of are kept from one visit to the next. */
type GetStorage = () => Pick<Storage, 'getItem' | 'setItem'>;
/** What decides whether focus goes to the rows of fixes. */
export interface FixesFocusState {
  stage: ErrorsNoticeStage;
  isPressFresh: boolean;
  isFocusWithin: boolean;
  wouldFetchKeyboard: boolean;
}
/** The place and stage the notice last changed to, when, and where the pointer was then. */
interface NoticeChange {
  place: string | null;
  stage: ErrorsNoticeStage | null;
  atMs: number;
  pointer: PointerPoint | null;
}
export function readErrorsKnownOf(getStorage: GetStorage): Record<string, number> {
  let storedText = getStorage().getItem('sheets-errors-known-of') ?? '{}';
  let knownOf: unknown = null;
  try {
    knownOf = JSON.parse(storedText);
  } catch {}
  if (typeof knownOf !== 'object' || knownOf === null) return {};
  return Object.fromEntries(Object.entries(knownOf).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}
export function noteErrorsKnownOf(sheetId: SheetId, count: number, getStorage: GetStorage = errorsKnownOfStorage): void {
  try {
    getStorage().setItem(
      'sheets-errors-known-of',
      JSON.stringify({
        ...readErrorsKnownOf(getStorage),
        [sheetId]: count,
      }),
    );
  } catch {}
}
export function areMoreErrorsThanKnown(sheetId: SheetId, count: number, getStorage: GetStorage = errorsKnownOfStorage): boolean {
  try {
    let knownCount = readErrorsKnownOf(getStorage)[sheetId] ?? 0;
    if (count < knownCount) noteErrorsKnownOf(sheetId, count, getStorage);
    return count > knownCount;
  } catch {
    return count > 0;
  }
}
export function trackErrorsOfferSighting(
  seenWithCount: number | null,
  countOffered: number | null,
  isInView: boolean,
  isShown: boolean,
): { seenWithCount: number | null; hasLeftView: boolean } {
  let isSeen = (isInView && isShown) || seenWithCount === countOffered;
  return {
    seenWithCount: isSeen ? countOffered : null,
    hasLeftView: isSeen && !isInView,
  };
}
export function scheduleErrorsOfferAnnounce(count: number | null, announce: () => void): (() => void) | undefined {
  if (count === null) return;
  let timer = setTimeout(announce, 6000);
  return () => clearTimeout(timer);
}
export function partStepOfTabInEntry(
  event: KeyWithModifiers & Pick<KeyboardEvent, 'key' | 'repeat' | 'shiftKey'>,
  mode: PageMode,
  cameInByPartTab: boolean,
  isApple = IS_APPLE_PLATFORM,
): 'partBefore' | 'nextPart' | null {
  if (event.key !== 'Tab' || hasShortcutModifier(event, isApple) || event.repeat) return null;
  if (!cameInByPartTab || !isEntryUntouched(mode)) return null;
  return event.shiftKey ? 'partBefore' : 'nextPart';
}
export async function askAgentToFixOfferedErrors(
  store: StoreToAskFixes,
  chat: Pick<ChatWithAgent, 'openWithWhatWasPressed'>,
  when: 'atOpening' | 'afterEdit',
): Promise<boolean> {
  let isAtOpening = when === 'atOpening';
  let view = store.getView();
  let offer = isAtOpening ? view.errorsAtOpening : view.errorsOffered;
  if (offer === null || store.isEventUnfinished()) return false;
  store.dispatch({
    kind: isAtOpening ? 'fixOfErrorsAtOpeningAsked' : 'fixOfErrorsAsked',
  });
  if (store.getView().selectionByAddress?.range !== offer.cells) return false;
  let wasAsked = await askAgentToFixSelection(chat, store);
  if (wasAsked)
    store.dispatch(
      view.errorsAtOpening !== null && isAtOpening
        ? {
            kind: 'errorsAtOpeningPutAway',
            sheetId: view.errorsAtOpening.sheetId,
          }
        : {
            kind: 'errorsOfferPutAway',
          },
    );
  return wasAsked;
}
export function focusPlaceForFixes(focusState: FixesFocusState): WhereFixesShow {
  if (shouldFocusFixChoices(focusState)) return 'inRows';
  return focusState.wouldFetchKeyboard ? 'outsideFrame' : 'elsewhere';
}
export function fixChoiceRowsOf(
  stage: FixesUnderWay,
  count: number,
  hasRowFocus: boolean,
  onActedOn: (act: Exclude<FixesAct, 'asked'>) => void,
): [OfferListRow, OfferListRow] {
  let discardWords = count === 1 ? sheetMessages.discardFix() : sheetMessages.discardAllFixes();
  if (stage === 'asked')
    return [
      {
        words: writingFormulasLabel(count),
        isShimmering: true,
        isStopAtEnd: true,
        isKeyOfStopUnheard: !hasRowFocus,
        onChosen: () => onActedOn('ended'),
      },
      {
        words: discardWords,
        onChosen: null,
      },
    ];
  return [
    {
      words: keepFixesLabel(count),
      isKeyOfStopUnheard: !hasRowFocus,
      onChosen: () => onActedOn('kept'),
    },
    {
      words: discardWords,
      hint: hasRowFocus ? escapeKeyHint() : '',
      onChosen: () => onActedOn('ended'),
    },
  ];
}
interface FixChoicesProps {
  stage: FixesUnderWay;
  count: number;
  ids: [string, string];
  rowWithFocus: 1 | 2 | null;
  onActedOn: (act: Exclude<FixesAct, 'asked'>) => void;
}
export function FixChoices({
  stage,
  count,
  ids: [keepRowId, endRowId],
  rowWithFocus,
  onActedOn,
}: FixChoicesProps) {
  let [firstRow, secondRow] = fixChoiceRowsOf(stage, count, rowWithFocus !== null, onActedOn);
  let isAsked = stage === 'asked';
  return <div role="listbox" aria-label={sheetMessages.fixErrors()} data-size={listRowSize()}><OfferRow row={firstRow} id={keepRowId} placeInList={1} rowsInList={isAsked ? 1 : 2} isHighlighted={rowWithFocus === 1} isEveryClickHeard isListNew={false}>{stage === 'asked' &&
          <OfferWand kind="asked" />}</OfferRow><RowsThatFold isFolded={isAsked} doesEase><OfferRow row={secondRow} id={endRowId} placeInList={2} isHighlighted={rowWithFocus === 2} isEveryClickHeard isListNew={false} /></RowsThatFold></div>;
}
export const errorsKnownOfStorage = () => localStorage;
export const nextErrorsOfferAnnounceStage = (announceStage: ErrorsAnnounceStage, isOffered: boolean, isShown: boolean): ErrorsAnnounceStage => {
  if (!isOffered) return 'notYet';
  return announceStage === 'now' && !isShown ? 'already' : announceStage;
};
export const ERRORS_NOTICE_TAB_STOP_ATTRIBUTE = 'data-tab-stop-of-errors-notice';
export const didFocusLeaveByTab = (
  relatedTarget: (EventTarget & Partial<Pick<Element, 'hasAttribute'>>) | null,
  lastKeyEvent: KeyboardEvent | null,
  isPointerDown: boolean,
): boolean =>
  !isPointerDown &&
  ((relatedTarget?.hasAttribute?.(ERRORS_NOTICE_TAB_STOP_ATTRIBUTE) === true && lastKeyEvent === null) ||
    (lastKeyEvent?.key === 'Tab' && !lastKeyEvent.defaultPrevented && lastKeyEvent.target === relatedTarget));
export const hasShortcutModifier = (event: KeyWithModifiers, isApple = IS_APPLE_PLATFORM): boolean =>
  (event.altKey && !isApple) || event.ctrlKey || event.metaKey;
export const isTrustedPlainTab = (
  event: KeyWithModifiers & Pick<KeyboardEvent, 'key' | 'isTrusted' | 'isComposing'>,
  hasWindowCaretReturned: boolean,
  isApple = IS_APPLE_PLATFORM,
): boolean =>
  event.key === 'Tab' && hasWindowCaretReturned && event.isTrusted && !event.isComposing && !hasShortcutModifier(event, isApple);
export const doesKeyStepBackIntoCellsButF6 = (key: string): boolean => doesKeyStepBackIntoCells(key) && key !== 'F6';
export const isPlainTabWhileNavigating = (
  event: KeyWithModifiers & Pick<KeyboardEvent, 'key'>,
  mode: PageMode,
  isPointerDown: boolean,
  isApple = IS_APPLE_PLATFORM,
): boolean => event.key === 'Tab' && !hasShortcutModifier(event, isApple) && mode.kind === 'navigating' && !isPointerDown;
export const ERRORS_NOTICE_TAB_STOP_PROPS = {
  type: 'button' as const,
  tabIndex: 0,
  'aria-hidden': true,
  [ERRORS_NOTICE_TAB_STOP_ATTRIBUTE]: '',
  className: 'sr-only',
};
export const ERRORS_NOTICE_PLACE_ATTRIBUTE = 'data-place-of-errors-notice';
export const ERRORS_OFFERED_ATTRIBUTE = 'data-errors-offered';
export const UNDECIDED_FIXES_OFFER_DELAY_MS = 1000;
export const ERRORS_OFFER_BUTTON_LABELS = {
  chat: sheetMessages.askAgentToFix,
  offered: sheetMessages.fixErrors,
};
export const ERRORS_OFFER_OPTION_SELECTOR = '[role=option]:not([aria-disabled])';
export const shouldFocusFixChoices = (focusState: FixesFocusState): boolean =>
  (focusState.stage === 'asked' || focusState.stage === 'waiting') &&
  !focusState.wouldFetchKeyboard &&
  (focusState.isFocusWithin || focusState.isPressFresh);
export const errorsPressGuardStandOf = (isShownNow: boolean, stage: ErrorsNoticeStage | null): PressGuardStand | null => {
  if (!isShownNow) return null;
  if (stage === 'asked') return 'whileAgentWrites';
  return stage === 'waiting' ? 'withAnswer' : 'otherwise';
};
export const optionIdOf = (target: EventTarget | null): string | undefined => (target instanceof Element ? target.closest('[role=option]')?.id : undefined);
export const cancelEscapeDismissal: NonNullable<PopoverRootProps['onOpenChange']> = (open, details) => {
  if (details.reason !== 'escape-key') return;
  details.cancel();
  if (details.event.currentTarget instanceof Document) details.allowPropagation();
};
interface ErrorsOfferNoticeProps {
  count: number | null;
  countOffered: number | null;
  isHeldBack: boolean;
  areItsCellsInView: boolean;
  canAttach: boolean;
  isChatToBeHad: boolean;
  anchor: PopoverPopupProps['anchor'];
  place: string;
  stageOfFixes: FixesBarStage['stage'] | null;
  countOfFixes: number;
  pressForFixes: PressForFixesTracker;
  holdOnFixes: AnswerHold | null;
  onActHeldAtFixes: () => void;
  onFixesActedOn: (act: FixesAct, how?: HowActBegan) => void;
  onFixAsked: () => Promise<boolean>;
  onPutAway: () => void;
  onWheelTurned: (event: WheelEvent) => boolean;
  onKeyPressed: (event: React.KeyboardEvent) => void;
  onGoneWithFocus: () => void;
}
export const ErrorsOfferNotice = React.memo(function ({
  count,
  countOffered,
  isHeldBack,
  areItsCellsInView,
  canAttach,
  isChatToBeHad,
  anchor,
  place,
  stageOfFixes,
  countOfFixes,
  pressForFixes,
  holdOnFixes,
  onActHeldAtFixes,
  onFixesActedOn,
  onFixAsked,
  onPutAway,
  onWheelTurned,
  onKeyPressed,
  onGoneWithFocus,
}: ErrorsOfferNoticeProps) {
  let lastCount: number | null = useLastNonNull(count);
  let [lastSettledStage, setLastSettledStage] = React.useState<'offered' | null>(null);
  if ((stageOfFixes === 'offered' || stageOfFixes === null) && stageOfFixes !== lastSettledStage) setLastSettledStage(stageOfFixes);
  const stage: ErrorsNoticeStage | null = stageOfFixes === 'undecided' ? lastSettledStage : stageOfFixes;
  let [isUndecidedLongEnough, setIsUndecidedLongEnough] = React.useState(false);
  React.useEffect(() => {
    if (stageOfFixes !== 'undecided' || !isChatToBeHad) return;
    let timer = setTimeout(() => setIsUndecidedLongEnough(true), UNDECIDED_FIXES_OFFER_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setIsUndecidedLongEnough(false);
    };
  }, [stageOfFixes, isChatToBeHad]);
  let areFixesUnderWay = stage === 'asked' || stage === 'waiting';
  let [highlightedRow, setHighlightedRow] = React.useState<1 | 2 | null>(null);
  if (!areFixesUnderWay && highlightedRow !== null) setHighlightedRow(null);
  let wouldFocusFetchKeyboard = React.useContext(CanTakeFocusContext);
  let [fixesAnnouncement, setFixesAnnouncement] = React.useState<{ stage: FixesUnderWay; are: WhereFixesShow } | null>(null);
  if (!areFixesUnderWay && fixesAnnouncement !== null) setFixesAnnouncement(null);
  let hasFocusRef = React.useRef(false);
  let [frozenFixCount, setFrozenFixCount] = React.useState<number | null>(null);
  let waitingFixCount = stage === 'waiting' ? (frozenFixCount ?? countOfFixes) : null;
  if (waitingFixCount !== frozenFixCount) setFrozenFixCount(waitingFixCount);
  let labelId = React.useId();
  let [keepRowId, endRowId] = [`${labelId}-first`, `${labelId}-second`];
  let safeAreaInsets = useBottomInset();
  let [isOpen, setIsOpen] = React.useState(false);
  let mayOpen = count !== null && !isHeldBack && !(stageOfFixes === 'undecided' && !isOpen && !isUndecidedLongEnough);
  let [seenWithCount, setSeenWithCount] = React.useState<number | null>(null);
  let { seenWithCount: nextSeenWithCount, hasLeftView } = trackErrorsOfferSighting(
    seenWithCount,
    countOffered,
    areItsCellsInView || areFixesUnderWay,
    mayOpen && (isOpen || canAttach),
  );
  if (nextSeenWithCount !== seenWithCount) setSeenWithCount(nextSeenWithCount);
  let isShown = mayOpen && !hasLeftView && (isOpen || canAttach);
  if (isShown !== isOpen) setIsOpen(isShown);
  const shownStage: ErrorsNoticeStage | 'chat' | null = useLastNonNull(isShown ? (stage ?? 'chat') : null);
  const isChoiceListShown = shownStage === 'asked' || shownStage === 'waiting';
  let shownFixCount: number = useLastNonNull(areFixesUnderWay ? countOfFixes : null) ?? countOfFixes;
  let [announceStage, setAnnounceStage] = React.useState<ErrorsAnnounceStage>('notYet');
  let nextAnnounceStage = nextErrorsOfferAnnounceStage(announceStage, countOffered !== null, isShown);
  if (nextAnnounceStage !== announceStage) setAnnounceStage(nextAnnounceStage);
  let canAct = stage !== null || canAttach;
  let countToAnnounce = isShown && canAct && !areFixesUnderWay && nextAnnounceStage === 'notYet' ? count : null;
  React.useEffect(
    () =>
      scheduleErrorsOfferAnnounce(
        countToAnnounce,
        () => setAnnounceStage((stageBefore) => (stageBefore === 'notYet' ? 'now' : stageBefore)),
      ),
    [countToAnnounce],
  );
  let [toldCount, setToldCount] = React.useState<number | null>(null);
  let countToTell = countOffered === null || areFixesUnderWay ? null : (count ?? toldCount);
  if (countToTell !== toldCount) setToldCount(countToTell);
  let isAskingRef = React.useRef(false);
  let lastChangeRef = React.useRef<NoticeChange>({
    place: null,
    stage: null,
    atMs: 0,
    pointer: null,
  });
  React.useLayoutEffect(() => {
    let { place: lastPlace, stage: lastStage } = lastChangeRef.current;
    if (!isShown)
      lastChangeRef.current = {
        place: null,
        stage: null,
        atMs: 0,
        pointer: null,
      };
    else if (lastPlace !== place || lastStage !== stage)
      lastChangeRef.current = {
        place,
        stage,
        atMs: performance.now(),
        pointer: getLastPointerPoint(),
      };
  }, [isShown, place, stage]);
  let pressStartRef = React.useRef<number | null>(null);
  let popupRef = React.useRef<HTMLDivElement | null>(null);
  let [isPopupMounted, setIsPopupMounted] = React.useState(false);
  let [tabStopBeforeRef, tabStopAfterRef] = [React.useRef<HTMLButtonElement>(null), React.useRef<HTMLButtonElement>(null)];
  let focusableRows = React.useCallback(
    () => [...(popupRef.current?.querySelectorAll<HTMLElement>(`${ERRORS_OFFER_OPTION_SELECTOR}, button:not([role=option])`) ?? [])],
    [],
  );
  let focusRowAt = React.useCallback(
    (index: number) =>
      focusableRows().at(index)?.focus({
        preventScroll: true,
      }),
    [focusableRows],
  );
  let onTabStopFocus = ({ relatedTarget }: React.FocusEvent, index: number) => {
    if ((relatedTarget instanceof Node && popupRef.current?.contains(relatedTarget)) !== true) focusRowAt(index);
  };
  let latestRef = React.useRef({
    onGoneWithFocus,
    pressForFixes,
    wouldFocusFetchKeyboard,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      onGoneWithFocus,
      pressForFixes,
      wouldFocusFetchKeyboard,
    };
  });
  React.useLayoutEffect(() => {
    let popup = popupRef.current;
    if (!isShown && popup !== null && popup.contains(popup.ownerDocument.activeElement)) latestRef.current.onGoneWithFocus();
  }, [isShown]);
  let isFocusInside = React.useCallback(() => {
    let popup = popupRef.current;
    let activeElement = popup?.ownerDocument.activeElement;
    return popup !== null && hasFocusRef.current && (activeElement === popup.ownerDocument.body || popup.contains(activeElement ?? null));
  }, []);
  let wereFixesUnderWayRef = React.useRef(false);
  React.useLayoutEffect(() => {
    let wereUnderWay = wereFixesUnderWayRef.current;
    wereFixesUnderWayRef.current = areFixesUnderWay;
    if (!wereUnderWay || areFixesUnderWay) return;
    latestRef.current.pressForFixes.forget();
    let hadFocus = isFocusInside();
    hasFocusRef.current = false;
    if (hadFocus && !latestRef.current.wouldFocusFetchKeyboard()) latestRef.current.onGoneWithFocus();
  }, [areFixesUnderWay, isFocusInside]);
  React.useLayoutEffect(() => {
    if (!isPopupMounted || !isShown || (stage !== 'asked' && stage !== 'waiting')) return;
    let { pressForFixes: pressForFixesNow, wouldFocusFetchKeyboard: wouldFocusFetchKeyboardNow } = latestRef.current;
    let focusState = {
      stage,
      isPressFresh: pressForFixesNow.isFresh(),
      isFocusWithin: isFocusInside(),
      wouldFetchKeyboard: wouldFocusFetchKeyboardNow(),
    };
    pressForFixesNow.forget();
    setFixesAnnouncement(
      (previous) =>
        previous?.stage === stage
          ? previous
          : {
              stage,
              are: focusPlaceForFixes(focusState),
            },
    );
    if (shouldFocusFixChoices(focusState)) focusRowAt(0);
  }, [stage, isPopupMounted, isShown, isFocusInside, focusRowAt]);
  let stageAtPressRef = React.useRef<ErrorsNoticeStage | null | 'none'>('none');
  let actHold = useActHoldAtAnswer({
    hold: holdOnFixes,
    tellOfActHeld: onActHeldAtFixes,
    isNoAct: () => false,
  });
  let pressGuard = useOfferPressGuard(errorsPressGuardStandOf(isShown && isPopupMounted, stage), popupRef, onActHeldAtFixes);
  let isClickDroppedRef = React.useRef(false);
  let noteStageAtPress = ({ currentTarget }: { currentTarget: Element }, endEventType: 'pointerup' | 'keyup') => {
    stageAtPressRef.current = stage;
    let defaultView = currentTarget.ownerDocument.defaultView;
    let forgetStage = () => void defaultView?.setTimeout(() => void (stageAtPressRef.current = 'none'));
    defaultView?.addEventListener(endEventType, forgetStage, {
      once: true,
      capture: true,
    });
  };
  let attachPopup = React.useCallback(
    (popup: HTMLDivElement | null) => {
      popupRef.current = popup;
      if (popup === null) return;
      popup.parentElement?.style.setProperty('pointer-events', 'none');
      let onWheel = (event: WheelEvent) => {
        if (onWheelTurned(event)) event.preventDefault();
      };
      popup.addEventListener('wheel', onWheel, {
        passive: false,
      });
      setIsPopupMounted(true);
      return () => {
        popup.removeEventListener('wheel', onWheel);
        setIsPopupMounted(false);
      };
    },
    [onWheelTurned],
  );
  let popover = <Popover.Root open={isShown} onOpenChange={cancelEscapeDismissal}><LiveAnnouncer words={areFixesUnderWay
          ? fixesAnnouncement?.stage === stage &&
            (stage === 'asked'
              ? agentWritingFixesText(fixesAnnouncement.are)
              : agentWroteFixesText(waitingFixCount ?? countOfFixes, fixesAnnouncement.are))
          : countToTell !== null && errorCountLabel(countToTell)} /><LiveAnnouncer words={nextAnnounceStage === 'now' && !areFixesUnderWay && ERRORS_OFFER_BUTTON_LABELS[stage === 'offered' ? 'offered' : 'chat']()} /><Popover.Popup ref={attachPopup} anchor={anchor} side="bottom" align="start" sideOffset={CELL_POPUP_SIDE_OFFSETS.under} collisionPadding={popupCollisionPadding(safeAreaInsets)} collisionAvoidance={{
          side: 'none',
          fallbackAxisSide: 'none',
        }} padding={isChoiceListShown ? 'xs' : 'none'} initialFocus={false} finalFocus={false} keepFocus role="group" aria-label={sheetMessages.errorsOnThisSheet()} data-errors-offered className={isChoiceListShown
          ? 'pointer-events-auto flex w-[304px] flex-col'
          : 'pointer-events-none flex h-9 items-center gap-1 ps-2.5 pe-1 whitespace-nowrap'} onMouseDown={isChoiceListShown ? preventMouseDownDefault : undefined} onFocus={({ target }) => {
          setAnnounceStage('already');
          setHighlightedRow(target.id === keepRowId ? 1 : target.id === endRowId ? 2 : null);
          hasFocusRef.current = true;
        }} onBlur={({ relatedTarget }) => {
          setHighlightedRow(null);
          if (relatedTarget !== null) hasFocusRef.current = false;
        }} onPointerDownCapture={(event) => {
          pressGuard.onPointerDownCapture?.(event);
          actHold.handlers.onPointerDownCapture(event);
          let now = performance.now();
          pressStartRef.current = isWithinPressGuard(lastChangeRef.current.atMs, now) ? now : null;
          isClickDroppedRef.current =
            optionIdOf(event.target) === endRowId &&
            event.pointerType === 'mouse' &&
            event.buttons !== 0 &&
            isPointerStillAt(lastChangeRef.current.pointer);
          noteStageAtPress(event, 'pointerup');
        }} onPointerMoveCapture={pressGuard.onPointerMoveCapture} onPointerUpCapture={actHold.handlers.onPointerUpCapture} onPointerCancelCapture={(event) => {
          pressGuard.onPointerCancelCapture?.(event);
          actHold.handlers.onPointerCancelCapture();
          isClickDroppedRef.current = false;
        }} onTransitionEndCapture={pressGuard.onTransitionEndCapture} onKeyDownCapture={actHold.handlers.onKeyDownCapture} onKeyUpCapture={actHold.handlers.onKeyUpCapture} onClickCapture={(event) => {
          actHold.handlers.onClickCapture();
          pressGuard.onClickCapture?.(event);
          let [pressStart, stageAtPress] = [pressStartRef.current, stageAtPressRef.current];
          [pressStartRef.current, stageAtPressRef.current] = [null, 'none'];
          let isDropped = isClickDroppedRef.current;
          isClickDroppedRef.current = false;
          if (event.isPropagationStopped()) return;
          let hasStageChanged = stageAtPress !== 'none' && stageAtPress !== stage;
          let now = performance.now();
          let isQuickClick = pressStart !== null && isWithinClickAfterUp(pressStart, now);
          if (hasStageChanged || isQuickClick || isWithinPressGuard(lastChangeRef.current.atMs, now)) return event.stopPropagation();
          if (isDropped && event.detail > 0) {
            lastChangeRef.current.pointer = null;
            onActHeldAtFixes();
            swallowRestOfPress(event, (target: EventTarget | null) => optionIdOf(target) === keepRowId, true);
            return event.stopPropagation();
          }
          let isOnOption = event.target instanceof Element && event.target.closest(ERRORS_OFFER_OPTION_SELECTOR) !== null;
          let mayAct = stage === 'asked' || !actHold.isActRefused();
          return isOnOption && mayAct ? swallowRestOfPress(event) : undefined;
        }} onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || (event.altKey && event.key !== 'Tab')) return onKeyPressed(event);
          let isActivationKey = event.key === 'Enter' || event.key === ' ';
          if (isActivationKey && (event.repeat || isWithinPressGuard(lastChangeRef.current.atMs, performance.now()))) {
            actHold.noteKeyThatTakesNothing();
            return event.preventDefault();
          }
          if (isActivationKey) noteStageAtPress(event, 'keyup');
          if (event.key === 'Escape' && areFixesUnderWay) {
            event.preventDefault();
            return !event.repeat && !isWithinPressGuard(lastChangeRef.current.atMs, performance.now())
              ? onFixesActedOn('ended', actHold.howActBegan())
              : actHold.noteKeyThatTakesNothing();
          }
          let rows = focusableRows();
          let matchIndex = rows.findIndex((row) => row === event.target);
          let [nextKey, previousKey] = areFixesUnderWay ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
          let step =
            event.key === nextKey || (event.key === 'Tab' && !event.shiftKey) ? 1 : event.key === previousKey || event.key === 'Tab' ? -1 : 0;
          let target = step === 0 ? undefined : rows[matchIndex + step];
          let tabStop = (step === 1 ? tabStopAfterRef : tabStopBeforeRef).current;
          if (target === undefined && event.key === 'Tab' && tabStop !== null && !event.defaultPrevented)
            return tabStop.focus({
              preventScroll: true,
            });
          if (target === undefined) return step !== 0 ? undefined : onKeyPressed(event);
          event.preventDefault();
          return target.focus({
            preventScroll: true,
          });
        }}>{isChoiceListShown
          ? <FixChoices stage={shownStage} count={shownFixCount} ids={[keepRowId, endRowId]} rowWithFocus={highlightedRow} onActedOn={(act) => onFixesActedOn(act, actHold.howActBegan())} />
          : (<><DangerWarningIcon /><span id={labelId} className="ps-0.5 pe-1.5">{lastCount === null ? '' : errorCountLabel(lastCount)}</span><Button variant="secondary" size="sm" icon={<AgentMark size={14} {...(!canAct && {
                      color: 'currentColor',
                    })} />} aria-disabled={!canAct} aria-describedby={labelId} className={`pointer-events-auto ${canAct ? '' : 'opacity-disabled'}`} tabIndex={-1} onMouseDown={preventMouseDownDefault} onClick={() => {
                    if (count === null) return;
                    if (stage === 'offered') return onFixesActedOn('asked');
                    if (!canAttach || isAskingRef.current) return;
                    isAskingRef.current = true;
                    onFixAsked().finally(() => {
                      isAskingRef.current = false;
                    });
                    return;
                  }}>{ERRORS_OFFER_BUTTON_LABELS[shownStage === 'offered' ? 'offered' : 'chat']()}</Button><Button variant="ghost" size="sm" iconOnly icon="X" tooltip={false} tabIndex={-1} aria-label={sheetMessages.dismissErrorsOffer()} className="pointer-events-auto text-secondary" onMouseDown={preventMouseDownDefault} onClick={onPutAway} /></>)}</Popover.Popup></Popover.Root>;
  return <span className="contents" {...{
      [ERRORS_NOTICE_PLACE_ATTRIBUTE]: '',
    }}>{isShown &&
        <button {...ERRORS_NOTICE_TAB_STOP_PROPS} ref={tabStopBeforeRef} onFocus={(event) => onTabStopFocus(event, 0)} onKeyUp={() => focusRowAt(0)} />}{withListTabStops(popover)}{isShown &&
        <button {...ERRORS_NOTICE_TAB_STOP_PROPS} ref={tabStopAfterRef} onFocus={(event) => onTabStopFocus(event, -1)} onKeyUp={() => focusRowAt(-1)} />}</span>;
});
