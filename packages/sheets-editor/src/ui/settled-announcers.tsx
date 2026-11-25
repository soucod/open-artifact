import type { SheetController } from '../state/controller.ts';
import type { UndoOffer } from '../state/initial-state.ts';
import type { PageView } from '../view/page-view.ts';
import * as React from 'react';
import { describeLastDone } from '../i18n/last-done-labels.ts';
import { undoableDoneText } from '../i18n/notice-labels.ts';
import { LAST_DONE_SETTLE_MS } from './last-done-announcer.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
/** What is to be said once the page has settled, and what of the page tells it has moved on. */
export interface WordsToSettle {
  words: string | null;
  /** What the words are about; new words about the same thing are not said again. */
  about?: string | null;
  nameBoxText: PageView['nameBoxText'];
  mode: PageView['mode'];
}
/** Calls back when something changes, and returns a way to stop. */
export type SubscribeToChange = (onChange: () => void) => () => void;
/** Says words in the live region; `null` takes back what was said. */
export type SayWords = (words: string | null) => void;
export type AnnouncerStore = Pick<SheetController, 'subscribe' | 'getView'>;
export function isUndoOfferAnnounced({ kind }: Pick<UndoOffer, 'kind'>): boolean {
  switch (kind) {
    case 'sheetDeleted':
    case 'placedViewDeleted':
    case 'namedViewDeleted':
    case 'rowsDeleted':
    case 'columnsDeleted':
    case 'mergeClearedCells':
    case 'tableImportedIntoSheet':
    case 'tableImportedAsNewSheet':
    case 'versionRestored':
    case 'textsConverted':
    case 'optionsGoneClearedCells':
    case 'sortChangedResults':
    case 'moveOfColumnsChangedResults':
      return true;
    case 'filledByFinger':
    case 'clearedWithNoKeyboard':
    case 'sortedWithNoKeyboard':
    case 'dropdownClearedCells':
    case 'dropdownOptionDeleted':
    case 'replacedInCells':
    case 'moveReplacedCells':
      return false;
  }
}
export function undoOfferWords(undoOffer: PageView['undoOffer'], saving: PageView['saving']) {
  if (undoOffer === null || !isUndoOfferAnnounced(undoOffer)) return null;
  if (!('isSaved' in undoOffer) && saving !== 'allSaved') return null;
  const undoWords = describeLastDone({
    what: 'undoOfferMade',
    offer: undoOffer,
  });
  return 'isSaved' in undoOffer && !undoOffer.isSaved && undoOffer.kind !== 'sortChangedResults' && undoOffer.kind !== 'moveOfColumnsChangedResults'
    ? undoWords
    : undoableDoneText(undoWords);
}
export function announceWhenSettled(
  subscribe: SubscribeToChange,
  readState: () => WordsToSettle,
  say: SayWords,
  subscribeToFocus: SubscribeToChange,
) {
  let { words, about, nameBoxText, mode } = readState();
  let lastSaid: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sayWhenSettled = () => {
    clearTimeout(timer);
    if (words === null || words === lastSaid) return;
    const wordsToSay = words;
    timer = setTimeout(() => {
      lastSaid = wordsToSay;
      say(wordsToSay);
    }, LAST_DONE_SETTLE_MS);
  };
  const unsubscribe = subscribe(() => {
    const { words: nextWords, about: nextAbout, nameBoxText: nextNameBoxText, mode: nextMode } = readState();
    const isNewWords = nextWords !== words || nextAbout !== about;
    if (!isNewWords && nextNameBoxText === nameBoxText && nextMode === mode) return;
    if (isNewWords && lastSaid !== null) {
      lastSaid = null;
      say(null);
    }
    words = nextWords;
    about = nextAbout;
    nameBoxText = nextNameBoxText;
    mode = nextMode;
    sayWhenSettled();
  });
  const unsubscribeFocus = subscribeToFocus(sayWhenSettled);
  sayWhenSettled();
  return () => {
    unsubscribe();
    unsubscribeFocus();
    clearTimeout(timer);
  };
}
export interface UndoOfferAnnouncerProps {
  store: AnnouncerStore;
  /** An element in the page, for its document. */
  inPageOf: React.RefObject<Element | null>;
}
export function UndoOfferAnnouncer({ store, inPageOf }: UndoOfferAnnouncerProps) {
  const [undoWords, setUndoWords] = React.useState<string | null>(null);
  React.useEffect(() => announceUndoOffers(store.subscribe, store.getView, setUndoWords, subscribeToFocusIn(inPageOf)), [store, inPageOf]);
  return <LiveAnnouncer words={undoWords} />;
}
export interface SettledWordsAnnouncerProps extends UndoOfferAnnouncerProps {
  words: string | null;
  about: string | null;
}
export function SettledWordsAnnouncer({ words, about, store, inPageOf }: SettledWordsAnnouncerProps) {
  const [settledWords, setSettledWords] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (words === null) return;
    const readState = () => {
      const { nameBoxText, mode } = store.getView();
      return {
        words,
        about,
        nameBoxText,
        mode,
      };
    };
    const stopAnnouncing = announceWhenSettled(store.subscribe, readState, setSettledWords, subscribeToFocusIn(inPageOf));
    return () => {
      stopAnnouncing();
      setSettledWords(null);
    };
  }, [words, about, store, inPageOf]);
  return <LiveAnnouncer words={settledWords} />;
}
/** Words to say as something opens, or `false` while there are none. */
export type OpenedWords = string | false;
export interface OpenedWordsState {
  wasSilent: boolean;
  /** The words said when it opened, said again once the page settles; `false` when there are none. */
  openedWith: OpenedWords;
}
export interface OpenedWordsAnnouncerProps extends UndoOfferAnnouncerProps {
  words: OpenedWords;
  isEntryOpen: boolean;
}
export function OpenedWordsAnnouncer({ words, isEntryOpen, store, inPageOf }: OpenedWordsAnnouncerProps) {
  const [openedState, setOpenedState] = React.useState<OpenedWordsState>({
    wasSilent: words === false,
    openedWith: false,
  });
  const stateNow = openedWordsState(
    {
      words,
      isEntryOpen,
    },
    openedState,
  );
  if (stateNow.wasSilent !== openedState.wasSilent || stateNow.openedWith !== openedState.openedWith) setOpenedState(stateNow);
  return <><SettledWordsAnnouncer words={stateNow.openedWith === false ? null : stateNow.openedWith} about={null} store={store} inPageOf={inPageOf} /><LiveAnnouncer words={stateNow.openedWith === false && words} /></>;
}
export const subscribeToFocusIn =
  (pageRef: React.RefObject<Element | null>): SubscribeToChange =>
  (onFocusIn) => {
    const pageDocument = pageRef.current?.ownerDocument;
    pageDocument?.addEventListener('focusin', onFocusIn, true);
    return () => pageDocument?.removeEventListener('focusin', onFocusIn, true);
  };
export const announceUndoOffers = (
  subscribe: SubscribeToChange,
  getView: AnnouncerStore['getView'],
  say: SayWords,
  subscribeToFocus: SubscribeToChange,
) =>
  announceWhenSettled(
    subscribe,
    () => {
      const { undoOffer, saving, nameBoxText, mode } = getView();
      return {
        words: undoOfferWords(undoOffer, saving),
        nameBoxText,
        mode,
      };
    },
    say,
    subscribeToFocus,
  );
export const openedWordsState = (
  { words, isEntryOpen }: Pick<OpenedWordsAnnouncerProps, 'words' | 'isEntryOpen'>,
  { wasSilent, openedWith }: OpenedWordsState,
): OpenedWordsState => ({
  wasSilent: words === false,
  openedWith: !isEntryOpen && (wasSilent ? words : openedWith === words && words),
});
