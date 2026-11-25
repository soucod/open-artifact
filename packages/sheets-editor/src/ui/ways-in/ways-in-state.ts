import * as React from 'react';
import { getBottomSafeAreaInset, subscribeBottomInsets } from '../../shell/bottom-insets.ts';
import type { SheetController } from '../../state/controller.ts';
import type { PageView } from '../../view/page-view.ts';
/** What becomes of the caret once a way in that had it is gone. */
export type WaysInFocusFate = 'asItIs' | 'toCells' | 'leftAlone';
export interface WaysInFocusSituation {
  isButtonInPage: boolean;
  isCaretOnBody: boolean;
  hasFrameFocus: boolean;
  areWaysInDue: boolean;
}
/** What the focus keeper asks of the page. */
export interface WaysInPageParts {
  areWaysInDue: () => boolean;
  giveToCells: () => void;
}
export interface WaysInFocusKeepingParts extends WaysInPageParts {
  findWaysIn: () => Element | null;
}
/** Keeps the caret in the page when the way in that had it goes away. */
export interface WaysInFocusKeeper {
  remember: (button: Element | null) => void;
  goBy(parts: WaysInPageParts): void;
}
/** Whether the ways in have room for the ask to the agent beside them. */
export type WaysInRoom = 'waysInAreNotDue' | 'hasRoom' | 'hasNoRoom' | 'notSettled';
/** How the agent is offered among the ways in: asked by a call, awaited, or not offered. */
export type AgentAmongWaysIn = (() => void) | 'awaited' | null;
export interface WaysInSituation {
  areDue: boolean;
  mayBeSeen: boolean;
  offered: AgentAmongWaysIn;
}
export interface WaysInShown {
  room: WaysInRoom;
  areSeen: boolean;
  askAgent: AgentAmongWaysIn;
}
/** How far an ask to the agent from the ways in has come. */
export type AgentAskStep = 'no' | 'pressed' | 'asked' | 'drafted';
export interface AgentAskFromWaysIn {
  areWaysInDue: boolean;
  isDraftWaiting: boolean;
}
export interface AgentAskedFromWaysInOptions extends AgentAskFromWaysIn {
  doCellsTakeNoText: boolean;
}
export function useWaysInWaitedFor(store: Pick<SheetController, 'dispatch'>, waysIn: PageView['waysIn'], isWaitPutOff: boolean): void {
  React.useEffect(() => {
    if (waysIn !== 'areToCome' || isWaitPutOff || isFrameCapture(document)) return;
    let timer = setTimeout(
      () =>
        store.dispatch({
          kind: 'waysInWaitedFor',
        }),
      WAYS_IN_WAIT_MS,
    );
    return () => clearTimeout(timer);
  }, [store, waysIn, isWaitPutOff]);
}
export function useEscapeSendsWaysInAway(store: Pick<SheetController, 'dispatch'>, isActive: boolean): void {
  React.useEffect(() => {
    if (!isActive) return;
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.activeElement === document.body)
        store.dispatch({
          kind: 'waysInSentAway',
        });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store, isActive]);
}
export function waysInFocusFate(situation: WaysInFocusSituation): WaysInFocusFate {
  if (situation.isButtonInPage) return 'asItIs';
  return situation.isCaretOnBody && situation.hasFrameFocus && !situation.areWaysInDue ? 'toCells' : 'leftAlone';
}
export function createWaysInFocusKeeper(): WaysInFocusKeeper {
  let rememberedButton: Element | null = null;
  let pageParts: WaysInPageParts | null = null;
  let mutationObserver: MutationObserver | null = null;
  let remember = (button: Element | null) => {
    rememberedButton = button;
    mutationObserver?.disconnect();
    let ownerDocument = button?.ownerDocument;
    let defaultView = ownerDocument?.defaultView ?? null;
    mutationObserver = defaultView === null ? null : new defaultView.MutationObserver(settleFocus);
    if (ownerDocument !== undefined)
      mutationObserver?.observe(ownerDocument.body, {
        childList: true,
        subtree: true,
      });
  };
  let settleFocus = () => {
    if (rememberedButton === null || pageParts === null) return;
    let ownerDocument = rememberedButton.ownerDocument;
    let fate = waysInFocusFate({
      isButtonInPage: rememberedButton.isConnected,
      isCaretOnBody: ownerDocument.activeElement === ownerDocument.body,
      hasFrameFocus: ownerDocument.hasFocus(),
      areWaysInDue: pageParts.areWaysInDue(),
    });
    if (fate === 'asItIs') return;
    remember(null);
    if (fate === 'toCells') pageParts.giveToCells();
  };
  return {
    remember,
    goBy(parts) {
      pageParts = parts;
    },
  };
}
export function useWaysInFocusKeeping({ findWaysIn, ...pageParts }: WaysInFocusKeepingParts): {
  onFocus: (event: React.FocusEvent) => void;
  onBlur: (event: React.FocusEvent) => void;
} {
  let [focusKeeper] = React.useState(createWaysInFocusKeeper);
  React.useEffect(() => focusKeeper.goBy(pageParts));
  React.useEffect(() => () => focusKeeper.remember(null), [focusKeeper]);
  let wayInOf = (target: EventTarget | null) => {
    let waysIn = findWaysIn();
    let defaultView = waysIn?.ownerDocument.defaultView ?? null;
    return defaultView !== null && target instanceof defaultView.Element && waysIn?.contains(target) === true ? target : null;
  };
  return {
    onFocus: ({ target }) => focusKeeper.remember(wayInOf(target)),
    onBlur: ({ relatedTarget }) => focusKeeper.remember(wayInOf(relatedTarget)),
  };
}
export function waysInRoom(lastRoom: WaysInRoom, areDue: boolean, offered: AgentAmongWaysIn): WaysInRoom {
  if (!areDue) return 'waysInAreNotDue';
  if (lastRoom === 'hasRoom' || typeof offered === 'function') return 'hasRoom';
  return lastRoom === 'hasNoRoom' || offered === null ? 'hasNoRoom' : 'notSettled';
}
export function waysInShown(lastRoom: WaysInRoom, { areDue, mayBeSeen, offered }: WaysInSituation): WaysInShown {
  let room = waysInRoom(lastRoom, areDue, offered);
  return {
    room,
    areSeen: areDue && mayBeSeen && room !== 'notSettled',
    askAgent: room === 'hasRoom' || room === 'notSettled' ? (offered ?? 'awaited') : null,
  };
}
export function useWaysInShown(situation: WaysInSituation): Omit<WaysInShown, 'room'> {
  let [lastRoom, setLastRoom] = React.useState<WaysInRoom>('waysInAreNotDue');
  let { room, ...shown } = waysInShown(lastRoom, situation);
  if (room !== lastRoom) setLastRoom(room);
  return shown;
}
export function useWaysInOutOfSightReport(store: Pick<SheetController, 'dispatch'>, areOutOfSight: boolean): void {
  React.useEffect(
    () =>
      store.dispatch({
        kind: 'waysInOutOfSightChanged',
        are: areOutOfSight,
      }),
    [store, areOutOfSight],
  );
}
export function useAgentAskedFromWaysIn({
  areWaysInDue,
  isDraftWaiting,
  doCellsTakeNoText,
}: AgentAskedFromWaysInOptions): { isAgentAsked: boolean; noteAgentAsked: () => void } {
  let [askStep, setAskStep] = React.useState<AgentAskStep>('no');
  let nextStep = agentAskStep(askStep, {
    areWaysInDue,
    isDraftWaiting,
  });
  if (nextStep !== askStep) setAskStep(nextStep);
  let forgetAsk = React.useCallback(() => setAskStep('no'), []);
  let isAgentAsked = nextStep === 'asked' || nextStep === 'drafted';
  React.useEffect(() => {
    if (nextStep !== 'pressed') return;
    let timer = setTimeout(() => setAskStep('asked'), AGENT_ASK_PRESSED_MS);
    return () => clearTimeout(timer);
  }, [nextStep]);
  React.useEffect(() => {
    if (!isAgentAsked) return;
    let latestScroll = getBottomSafeAreaInset();
    let stopWatching = subscribeBottomInsets(() => {
      let scrolledTo = getBottomSafeAreaInset();
      if (scrolledTo < latestScroll - ANNOUNCEMENT_SCROLL_SLACK) forgetAsk();
      latestScroll = Math.max(latestScroll, scrolledTo);
    });
    document.addEventListener('pointerdown', forgetAsk, true);
    document.addEventListener('keydown', forgetAsk, true);
    return () => {
      stopWatching();
      document.removeEventListener('pointerdown', forgetAsk, true);
      document.removeEventListener('keydown', forgetAsk, true);
    };
  }, [isAgentAsked, forgetAsk]);
  let didCellsTakeNoTextRef = React.useRef(false);
  React.useEffect(() => {
    if (didCellsTakeNoTextRef.current && !doCellsTakeNoText && document.hasFocus()) forgetAsk();
    didCellsTakeNoTextRef.current = doCellsTakeNoText;
  }, [doCellsTakeNoText, forgetAsk]);
  React.useEffect(() => {
    if (nextStep !== 'drafted' || isDraftWaiting) return;
    let timer = setTimeout(forgetAsk, DRAFTED_ASK_LINGER_MS);
    return () => clearTimeout(timer);
  }, [nextStep, isDraftWaiting, forgetAsk]);
  return {
    isAgentAsked,
    noteAgentAsked: React.useCallback(() => setAskStep('pressed'), []),
  };
}
export const isFrameCapture = (doc: Document): boolean => doc.documentElement.hasAttribute('data-frame-capture');
export const WAYS_IN_WAIT_MS = 800;
export const areAnnouncementsUnderWay = (): boolean => getBottomSafeAreaInset() > 0;
export const useAnnouncementsUnderWay = (): boolean =>
  React.useSyncExternalStore(subscribeBottomInsets, areAnnouncementsUnderWay, () => false);
export const DRAFTED_ASK_LINGER_MS = 1500;
export const AGENT_ASK_PRESSED_MS = 500;
export const ANNOUNCEMENT_SCROLL_SLACK = 40;
export const agentAskStep = (askStep: AgentAskStep, { areWaysInDue, isDraftWaiting }: AgentAskFromWaysIn): AgentAskStep => {
  if (!areWaysInDue) return 'no';
  return askStep === 'asked' && isDraftWaiting ? 'drafted' : askStep;
};
