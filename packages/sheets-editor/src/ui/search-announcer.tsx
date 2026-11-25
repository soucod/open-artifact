import { useUiWindow } from '../kit/theme.tsx';
import * as React from 'react';
import { LiveAnnouncer } from './live-announcer.tsx';
/** The words a search found to be said, or `false` when what is typed found nothing to say. */
export type FoundWords = string | false | null;
/** The words said about a search, and how many times words were said. */
export interface TypedSearchAnnouncement {
  words: string | null;
  times: number;
}
export interface TypedSearchAnnouncerProps {
  typed: string;
  /** The words for what is found, read once the person is not composing text. */
  found: (isNotComposing: boolean) => FoundWords;
  /** Words to say at once in place of what is found. */
  atOnce?: string | null;
}
export function createTypedSearchAnnouncer(announce: (announcement: TypedSearchAnnouncement) => void) {
  let announced = NO_TYPED_SEARCH_ANNOUNCEMENT;
  let lastGiven: { typed: string; found: FoundWords } | null = null;
  let announceTimer: ReturnType<typeof setTimeout> | undefined;
  let setAnnounced = (next: TypedSearchAnnouncement) => {
    announced = next;
    announce(next);
  };
  let clearWords = () => {
    if (announced.words !== null)
      setAnnounced({
        ...announced,
        words: null,
      });
  };
  return {
    give(typed: string, found: FoundWords) {
      if (lastGiven?.typed === typed && lastGiven.found === found) return;
      lastGiven = {
        typed,
        found,
      };
      clearTimeout(announceTimer);
      if (found === false) return clearWords();
      announceTimer = setTimeout(
        () =>
          setAnnounced({
            words: found,
            times: announced.times + 1,
          }),
        TYPED_SEARCH_ANNOUNCE_DELAY_MS,
      );
    },
    stop() {
      lastGiven = null;
      clearTimeout(announceTimer);
    },
  };
}
export function useTextFieldFocusState() {
  let pageWindow = useUiWindow();
  let subscribeFocusIn = React.useCallback(
    (onFocusIn: () => void) => (
      pageWindow?.document.addEventListener('focusin', onFocusIn, true),
      () => pageWindow?.document.removeEventListener('focusin', onFocusIn, true)
    ),
    [pageWindow],
  );
  let isInField = React.useSyncExternalStore(
    subscribeFocusIn,
    () => pageWindow !== undefined && pageWindow.document.activeElement instanceof pageWindow.HTMLInputElement,
    () => false,
  );
  let [isComposing, setIsComposing] = React.useState(false);
  React.useEffect(() => {
    let ownerDocument = pageWindow?.document;
    let onCompositionStart = () => setIsComposing(true);
    let onCompositionEndOrFocus = () => setIsComposing(false);
    ownerDocument?.addEventListener('compositionstart', onCompositionStart, true);
    ownerDocument?.addEventListener('compositionend', onCompositionEndOrFocus, true);
    ownerDocument?.addEventListener('focusin', onCompositionEndOrFocus, true);
    return () => {
      ownerDocument?.removeEventListener('compositionstart', onCompositionStart, true);
      ownerDocument?.removeEventListener('compositionend', onCompositionEndOrFocus, true);
      ownerDocument?.removeEventListener('focusin', onCompositionEndOrFocus, true);
    };
  }, [pageWindow]);
  return {
    isInField,
    isComposing,
  };
}
export function TypedSearchAnnouncer({ typed, found, atOnce = null }: TypedSearchAnnouncerProps) {
  let [announced, setAnnounced] = React.useState(NO_TYPED_SEARCH_ANNOUNCEMENT);
  let [announcer] = React.useState(() => createTypedSearchAnnouncer(setAnnounced));
  let { isInField, isComposing } = useTextFieldFocusState();
  let foundWords = isInField && found(!isComposing);
  React.useEffect(() => announcer.give(typed, foundWords), [announcer, typed, foundWords]);
  React.useEffect(() => announcer.stop, [announcer]);
  return <LiveAnnouncer words={atOnce ?? (foundWords !== false && announced.words)} timesSaid={announced.times} />;
}
export const TYPED_SEARCH_ANNOUNCE_DELAY_MS = 1400;
export const NO_TYPED_SEARCH_ANNOUNCEMENT: TypedSearchAnnouncement = {
  words: null,
  times: 0,
};
