import { CoachMark } from '../kit/coach-mark.tsx';
import { Button } from '../kit/button.tsx';
import type { CoachMarkProps } from '../kit/coach-mark.tsx';
import type { ThemeMode } from '../kit/theme.tsx';
import type { CaretTarget } from '../tables/own-filter-bar-view.tsx';
import * as React from 'react';
import { asThemeMode, THEME_CHOSEN_ATTRIBUTE, chooseSheetsTheme } from '../shell/root-theme.ts';
import { sheetThemeFollowedNotice } from '../i18n/change-labels.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
/** The theme the sheet changed from, and the one it now follows. */
export interface ThemeChange {
  from: ThemeMode;
  to: ThemeMode;
}
export interface ThemeChangeNoticeState {
  change: ThemeChange | null;
  isOpen: boolean;
}
export interface ThemeChangeWatch {
  subscribe(onChanged: () => void): () => void;
  now(): ThemeChangeNoticeState;
  isOver(): void;
}
/** Notes the theme drawn now, and returns the theme drawn last time when it was another one the person has not been told of. */
export function rememberThemeDrawn(themeMode: ThemeMode, isChosen: boolean, storage: () => Storage = themeNoticeStorage) {
  try {
    const store = storage();
    const lastDrawn = asThemeMode(store.getItem(THEME_LAST_DRAWN_KEY));
    store.setItem(THEME_LAST_DRAWN_KEY, themeMode);
    if (isChosen) store.setItem(THEME_CHANGE_TOLD_KEY, 'chosen');
    return lastDrawn === themeMode || store.getItem(THEME_CHANGE_TOLD_KEY) !== null ? null : lastDrawn;
  } catch {
    return null;
  }
}
export function markThemeChangeTold(storage: () => Storage = themeNoticeStorage) {
  try {
    storage().setItem(THEME_CHANGE_TOLD_KEY, 'told');
  } catch {}
}
export function createThemeChangeWatch(getElement: () => Element | null): ThemeChangeWatch {
  let noticeState: ThemeChangeNoticeState = {
    change: null,
    isOpen: false,
  };
  let onChange: (() => void) | null = null;
  let lastSeen = '';
  const setChange = (change: ThemeChange | null) => {
    if (change === null && !noticeState.isOpen) return;
    noticeState =
      change === null
        ? {
            ...noticeState,
            isOpen: false,
          }
        : {
            change,
            isOpen: true,
          };
    onChange?.();
  };
  const checkTheme = (defaultView: Window) => {
    const doc = defaultView.document;
    if (doc.visibilityState !== 'visible' || defaultView.matchMedia('print').matches) return;
    if ((getElement()?.getClientRects().length ?? 0) === 0) return;
    const root = doc.documentElement;
    const chosenTheme = asThemeMode(root.getAttribute(THEME_CHOSEN_ATTRIBUTE));
    const systemTheme = defaultView.matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light';
    const drawnTheme = chosenTheme ?? asThemeMode(root.getAttribute('data-theme')) ?? systemTheme;
    if (lastSeen === `${drawnTheme} ${chosenTheme}`) return;
    lastSeen = `${drawnTheme} ${chosenTheme}`;
    const changedFrom = rememberThemeDrawn(drawnTheme, chosenTheme !== null);
    setChange(
      changedFrom === null
        ? null
        : {
            from: changedFrom,
            to: drawnTheme,
          },
    );
  };
  return {
    subscribe(onChanged: () => void) {
      const defaultView = getElement()?.ownerDocument.defaultView ?? null;
      if (defaultView === null)
        return () => {
          return;
        };
      onChange = onChanged;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const checkSoon = () => {
        clearTimeout(timer);
        timer = setTimeout(() => checkTheme(defaultView), THEME_CHECK_DELAY_MS);
      };
      const mutationObserver = new defaultView.MutationObserver(checkSoon);
      mutationObserver.observe(defaultView.document.documentElement, {
        attributeFilter: [THEME_CHOSEN_ATTRIBUTE, 'data-theme'],
      });
      const darkQuery = defaultView.matchMedia('(prefers-color-scheme:dark)');
      darkQuery.addEventListener('change', checkSoon);
      defaultView.document.addEventListener('visibilitychange', checkSoon);
      checkSoon();
      return () => {
        onChange = null;
        clearTimeout(timer);
        mutationObserver.disconnect();
        darkQuery.removeEventListener('change', checkSoon);
        defaultView.document.removeEventListener('visibilitychange', checkSoon);
      };
    },
    now: () => noticeState,
    isOver: () => setChange(null),
  };
}
export const THEME_LAST_DRAWN_KEY = 'sheets-theme-last-drawn';
export const THEME_CHANGE_TOLD_KEY = 'sheets-theme-change-told';
export const themeNoticeStorage = () => localStorage;
export const THEME_CHECK_DELAY_MS = 1000;
export const NO_THEME_CHANGE: ThemeChangeNoticeState = {
  change: null,
  isOpen: false,
};
export interface ThemeChangeNoticeProps {
  /** Gets the zoom button, which the notice points at. */
  zoomButton: () => HTMLElement | null;
  side: CoachMarkProps['side'];
  isEntryOpen: boolean;
  whatHasCaretAfter: () => CaretTarget;
}
export const ThemeChangeNotice = React.memo(function ({
  zoomButton,
  side,
  isEntryOpen,
  whatHasCaretAfter,
}: ThemeChangeNoticeProps) {
  const [themeWatch] = React.useState(() => createThemeChangeWatch(zoomButton));
  const { change, isOpen } = React.useSyncExternalStore(themeWatch.subscribe, themeWatch.now, () => NO_THEME_CHANGE);
  const isShown = isOpen && !isEntryOpen;
  const noticeWords = React.useMemo(() => (change === null ? null : sheetThemeFollowedNotice(change.to)), [change]);
  const coachMarkRef = React.useRef<HTMLDivElement>(null);
  const onOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) themeWatch.isOver();
    },
    [themeWatch],
  );
  const finalFocus = React.useCallback(() => {
    const coachMark = coachMarkRef.current;
    const activeElement = coachMark?.ownerDocument.activeElement ?? null;
    return coachMark !== null && (coachMark.contains(activeElement) || activeElement === coachMark.ownerDocument.body) ? whatHasCaretAfter() : false;
  }, [whatHasCaretAfter]);
  const keepOtherButton = React.useMemo(
    () =>
      change !== null &&
      noticeWords !== null &&
      (<Button variant="secondary" size="sm" onClick={({ currentTarget }) => {
          chooseSheetsTheme(currentTarget.ownerDocument.documentElement, change.from);
          themeWatch.isOver();
        }}>{noticeWords.keepOther}</Button>),
    [change, noticeWords, themeWatch],
  );
  return <><LiveAnnouncer words={isShown && noticeWords !== null && noticeWords.said} />{noticeWords !== null &&
        <CoachMark key={side} ref={coachMarkRef} open={isShown} onOpenChange={onOpenChange} onShown={markThemeChangeTold} anchor={zoomButton} finalFocus={finalFocus} side={side} align="end" variant="neutral" aria-label={noticeWords.title} title={noticeWords.title} showClose lightDismiss action={keepOtherButton}>{noticeWords.whereToChange}</CoachMark>}</>;
});
