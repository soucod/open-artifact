import * as React from 'react';
import { getKeptOffCount } from '../app/keys-off-cells.ts';
import { ANNOUNCEMENT_HOLD_MS } from './agent-said-announcer.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { cellsAddedToMessageText } from '../i18n/menu-labels.ts';
import { MountedToast } from '../ui/mounted-toast.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { LAST_DONE_SETTLE_MS } from '../ui/last-done-announcer.ts';
import type { AskBesidePress, ChatWithAgent } from './chat-with-agent.ts';
import type { SelectionForAgent } from '../state/initial-state.ts';
import type { SheetController } from '../state/controller.ts';
/** Where the keyboard is: before a notice owed for keys kept off, at the cells (taking text or paused), in a menu, or elsewhere. */
export type PlaceOfKeyboard = 'beforeNotice' | 'elsewhere' | 'pausedAtCells' | 'inCells' | 'inMenu';
/** Cells a press put in the message to the agent, and which press it was. */
export interface CellsAddedByPress {
  cells: string;
  press: number;
}
/** Cells added to the message as they are told, and whether to tell that keys are paused at the cells. */
interface CellsAddedTold extends CellsAddedByPress {
  isPauseToBeTold: boolean;
}
/** Takes cells to the chat and keeps the newest cells it took. */
export interface CellsAddedToChat extends Pick<ChatWithAgent, 'openAboutCells' | 'openWithWhatWasPressed'> {
  subscribe(listener: () => void): () => void;
  newestAdded(): CellsAddedByPress | null;
  /** The press whose cells are to be told by a toast, or 0 for none. */
  newestThatTellsPress(): number;
}
/** What of the store tells when the keyboard has moved. */
type StoreToSettle = Pick<SheetController, 'subscribe' | 'getView'>;
interface CellsAddedAnnouncerProps {
  store: StoreToSettle;
  chat: Pick<CellsAddedToChat, 'subscribe' | 'newestAdded'>;
  placeOfKeyboard: () => PlaceOfKeyboard;
}
interface AddedToMessageToastProps {
  store: StoreToSettle;
  chat: Pick<CellsAddedToChat, 'subscribe' | 'newestThatTellsPress'>;
  placeOfKeyboard: () => PlaceOfKeyboard;
  hasWindowFocus: () => boolean;
  isAgentWorking: boolean;
  onGone: () => void;
}
export function trackCellsAddedToChat(chatWithAgent: Pick<ChatWithAgent, 'openAboutCells' | 'openWithWhatWasPressed'>): CellsAddedToChat {
  let newestAdded: CellsAddedByPress | null = null;
  let pressToTell = 0;
  let pressCount = 0;
  let listeners = new Set<() => void>();
  let trackOpening = (cells: string, tellsPress: boolean, open: () => Promise<boolean>) => {
    pressCount += 1;
    let added: CellsAddedByPress = {
      cells,
      press: pressCount,
    };
    let opening = open();
    let noteOpened = (isOpened: boolean) => {
      let newestBefore = newestAdded;
      newestAdded = newerPressOf(newestBefore, added, isOpened);
      if (newestAdded === newestBefore) return;
      pressToTell = tellsPress ? added.press : 0;
      for (let listener of listeners) listener();
    };
    opening.then(noteOpened, () => {});
    return opening;
  };
  return {
    openAboutCells: (cells: SelectionForAgent) => trackOpening(cells.range, false, () => chatWithAgent.openAboutCells(cells)),
    openWithWhatWasPressed: (label: string, cells: SelectionForAgent, pressed: string, ask: AskBesidePress) =>
      trackOpening(cells.range, true, () => chatWithAgent.openWithWhatWasPressed(label, cells, pressed, ask)),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    newestAdded: () => newestAdded,
    newestThatTellsPress: () => pressToTell,
  };
}
export function whenKeyboardPlaceSettles(
  { subscribe, getView }: StoreToSettle,
  placeOfKeyboard: () => PlaceOfKeyboard,
  keptOffCount: () => number,
  onSettled: (isPausedAtCells: boolean) => void,
): () => void {
  let startView: Pick<ReturnType<StoreToSettle['getView']>, 'nameBoxText' | 'mode'> = getView();
  let place = placeOfKeyboard();
  let keptOff = keptOffCount();
  let pollsAlike = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let poll = () => {
    let [placeBefore, keptOffBefore] = [place, keptOff];
    place = placeOfKeyboard();
    keptOff = keptOffCount();
    pollsAlike = place === placeBefore && keptOff === keptOffBefore && place !== 'inMenu' && place !== 'beforeNotice' ? pollsAlike + 1 : 0;
    if (pollsAlike < SETTLE_POLLS_NEEDED) {
      timer = setTimeout(poll, SETTLE_POLL_MS);
      return;
    }
    unsubscribe();
    onSettled(place === 'pausedAtCells');
  };
  let pollAfresh = () => {
    clearTimeout(timer);
    pollsAlike = 0;
    timer = setTimeout(poll, SETTLE_POLL_MS);
  };
  let unsubscribe = subscribe(() => {
    let { nameBoxText, mode } = getView();
    if (nameBoxText === startView.nameBoxText && mode === startView.mode) return;
    startView = {
      nameBoxText,
      mode,
    };
    pollAfresh();
  });
  pollAfresh();
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
export function CellsAddedAnnouncer({ store, chat, placeOfKeyboard }: CellsAddedAnnouncerProps) {
  const newestAdded = React.useSyncExternalStore(chat.subscribe, chat.newestAdded, chat.newestAdded);
  let [told, setTold] = React.useState<CellsAddedTold | null>(null);
  let placeOfKeyboardNow = React.useEffectEvent(placeOfKeyboard);
  React.useEffect(() => {
    if (newestAdded === null) return;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting = whenKeyboardPlaceSettles(
      store,
      () => placeOfKeyboardNow(),
      getKeptOffCount,
      (isPausedAtCells) => {
        setTold({
          ...newestAdded,
          isPauseToBeTold: isPausedAtCells,
        });
        holdTimer = setTimeout(() => setTold(null), ANNOUNCEMENT_HOLD_MS);
      },
    );
    return () => {
      stopWaiting();
      clearTimeout(holdTimer);
    };
  }, [store, newestAdded]);
  return <LiveAnnouncer words={told !== null && cellsAddedToMessageText(told.cells, told.isPauseToBeTold)} timesSaid={told?.press ?? 0} />;
}
export function whenUnfocusedFor(isFocused: () => boolean, onUnfocusedLong: () => void): () => void {
  let lastFocusedAt = Date.now();
  let timer = setInterval(() => {
    if (isFocused()) lastFocusedAt = Date.now();
    if (Date.now() - lastFocusedAt < UNFOCUSED_DISMISS_MS) return;
    clearInterval(timer);
    onUnfocusedLong();
  }, SETTLE_POLL_MS);
  return () => clearInterval(timer);
}
export function AddedToMessageToast({
  store,
  chat,
  placeOfKeyboard,
  hasWindowFocus,
  isAgentWorking,
  onGone,
}: AddedToMessageToastProps) {
  let pressToTell = React.useSyncExternalStore(chat.subscribe, chat.newestThatTellsPress, chat.newestThatTellsPress);
  let [pressSettled, setPressSettled] = React.useState(0);
  let [pressDismissed, setPressDismissed] = React.useState(0);
  let placeOfKeyboardNow = React.useEffectEvent(placeOfKeyboard);
  React.useEffect(
    () =>
      pressToTell === 0
        ? undefined
        : whenKeyboardPlaceSettles(
            store,
            () => placeOfKeyboardNow(),
            getKeptOffCount,
            () => setPressSettled(pressToTell),
          ),
    [store, pressToTell],
  );
  let [wasAgentWorking, setWasAgentWorking] = React.useState(isAgentWorking);
  if (isAgentWorking !== wasAgentWorking) {
    setWasAgentWorking(isAgentWorking);
    if (isAgentWorking) setPressDismissed(Math.max(pressDismissed, pressToTell));
  }
  let isToastUp = pressToTell !== 0 && pressToTell === pressSettled && pressToTell > pressDismissed;
  let hasWindowFocusNow = React.useEffectEvent(hasWindowFocus);
  React.useEffect(
    () =>
      isToastUp
        ? whenUnfocusedFor(
            () => hasWindowFocusNow(),
            () => setPressDismissed((dismissedBefore) => Math.max(dismissedBefore, pressToTell)),
          )
        : undefined,
    [isToastUp, pressToTell],
  );
  if (!isToastUp) return null;
  return <MountedToast key={pressToTell} words={sheetMessages.addedToYourMessage()} staysUntilClosed={false} onOver={() => {
        setPressDismissed((dismissedBefore) => Math.max(dismissedBefore, pressToTell));
        onGone();
      }} onTakenDown={onGone} />;
}
export const newerPressOf = (newest: CellsAddedByPress | null, candidate: CellsAddedByPress, isOpened: boolean): CellsAddedByPress | null =>
  isOpened && candidate.press > (newest?.press ?? 0) ? candidate : newest;
export const SETTLE_POLL_MS = 100;
export const SETTLE_POLLS_NEEDED = Math.ceil(LAST_DONE_SETTLE_MS / SETTLE_POLL_MS);
export const UNFOCUSED_DISMISS_MS = 6000;
