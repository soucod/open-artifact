import { shortcutKeycapClassName } from '../kit/shortcut.tsx';
import * as React from 'react';
import { entryGridlineOverlap, cellEntryBoxStyle } from '../grid/grid-drawing.tsx';
import { entryFontStyle } from '../grid/cell-drawing.tsx';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { isSameCell } from '../selection/model.ts';
import { useSuggestionLabel, suggestionGoneText, suggestionHeardAs, tabKeyLabel } from '../i18n/menu-labels.ts';
import { OFFER_ANNOUNCE_DELAY_MS } from '../formulas/from-words/offer-list.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { TAP_HOLD_LIMIT_MS } from '../selection/finger-taps.ts';
import type { GridOfPage, WordsOfferedShown } from '../view/page-view.ts';
import type { WordsOffered as WordsOfferedOfPage } from '../state/initial-state.ts';
import type { SheetController } from '../state/controller.ts';
import type { CellEntryTyped } from '../state/event-reducer.ts';
/** The grid's entry box the words offered are laid over. */
export type GridOfWordsOffered = Pick<GridOfPage, 'body' | 'editorKeepsClear' | 'editorBox' | 'editorScale' | 'editorFormat'>;
/** The words offered as they were last shown. */
export type WordsOfferedSeen = Pick<WordsOfferedOfPage, 'cellId' | 'typed' | 'offered'>;
/** A press that may end on the button over the words offered: whether it began on it, and when it came down and was let go (no time for a mouse). */
export interface WordsOfferedPress {
  beganOnButton: boolean;
  cameDownAtMs: number | null;
  wasLetGoAtMs: number | null;
}
/** The field an entry is typed in. */
export type EntryTextField = HTMLInputElement | HTMLTextAreaElement;
export interface WordsOfferedProps {
  grid: GridOfPage;
  offered: WordsOfferedShown | null;
  isKeyDrawn: boolean;
  store: Pick<SheetController, 'dispatch'>;
}
export interface WordsOfferedButtonProps {
  grid: GridOfPage;
  offered: WordsOfferedShown | null;
  isKeyDrawn: boolean;
  onPressed: (offered: WordsOfferedShown, pressedAtMs: number) => void;
}
export interface WordsOfferedAnnouncerProps {
  words: string | null;
  hasGone: boolean;
  isKeyDrawn: boolean;
}
export interface RestOfWordsOfferedProps {
  rest: string;
  keyIs: 'leftOut' | 'seen' | 'unseen';
}
export function wordsOfferedPlaceProps({
  body,
  editorKeepsClear,
  editorBox,
  editorScale,
  editorFormat,
}: GridOfWordsOffered) {
  if (editorBox === null) return null;
  return {
    'data-starts-on-line-at-left': entryGridlineOverlap(editorBox, editorScale).x > 0 || undefined,
    style: {
      ...cellEntryBoxStyle(editorBox, body, editorFormat, editorKeepsClear, {
        lineCount: 1,
        foldsAt: null,
        scale: editorScale,
      }),
      ...entryFontStyle(editorFormat.font, false),
    },
  };
}
export function WordsOffered({ grid, offered, isKeyDrawn, store }: WordsOfferedProps) {
  let { body, clearBodyHeight, editorLineCount, editorScale } = grid;
  let wordsRef = React.useRef<HTMLSpanElement>(null);
  let [bodyRight, bodyBottom] = [body.left + body.width + 1, body.top + clearBodyHeight + 1];
  React.useLayoutEffect(() => {
    if (offered === null) return;
    let wordsElement = wordsRef.current;
    let editorElement = wordsElement?.nextElementSibling ?? null;
    if (
      !(
        editorLineCount === 1 &&
        wordsElement !== null &&
        editorElement !== null &&
        doWordsOfferedFit(wordsElement, editorElement, {
          right: bodyRight,
          bottom: bodyBottom,
          scale: editorScale,
        })
      )
    )
      store.dispatch({
        kind: 'wordsOfferedWithdrawn',
        isOutOfView: true,
      });
  });
  let [offeredCellId, offeredTyped, offeredWords] = [offered?.cellId, offered?.typed, offered?.offered];
  let isWaitingToShow = offered?.isShown === false;
  let [lastShown, setLastShown] = React.useState<WordsOfferedSeen | null>(null);
  React.useEffect(() => {
    let defaultView = wordsRef.current?.ownerDocument.defaultView ?? null;
    if (!isWaitingToShow || defaultView === null) return;
    if (offeredCellId === undefined || offeredTyped === undefined || offeredWords === undefined) return;
    let timer: number | undefined;
    let isCancelled = false;
    let unlessCancelled =
      (act: () => void) =>
      () => {
        if (!isCancelled) act();
      };
    afterNextFrameOrTimeout(
      defaultView,
      unlessCancelled(() => {
        timer = defaultView.setTimeout(() => {
          setLastShown({
            cellId: offeredCellId,
            typed: offeredTyped,
            offered: offeredWords,
          });
          afterNextFrameOrTimeout(
            defaultView,
            unlessCancelled(
              () =>
                store.dispatch({
                  kind: 'wordsOfferedShown',
                  cellId: offeredCellId,
                  typed: offeredTyped,
                  offered: offeredWords,
                  ...(!isKeyDrawn && {
                    isWithNoKey: true,
                  }),
                }),
            ),
          );
        }, WORDS_OFFERED_SHOW_DELAY_MS);
      }),
    );
    return () => {
      isCancelled = true;
      defaultView.clearTimeout(timer);
      setLastShown(null);
    };
  }, [store, isWaitingToShow, offeredCellId, offeredTyped, offeredWords, isKeyDrawn]);
  let placeProps = wordsOfferedPlaceProps(grid);
  if (placeProps === null || offered === null) return null;
  let wasShownBefore =
    lastShown !== null && isSameCell(lastShown.cellId, offered.cellId) && lastShown.typed === offered.typed && lastShown.offered === offered.offered;
  return <span ref={wordsRef} aria-hidden className="sheet-words-offered" {...placeProps}><span className="invisible">{offered.typed}</span><RestOfWordsOffered rest={offered.rest} keyIs={!isKeyDrawn ? 'leftOut' : offered.isShown || wasShownBefore ? 'seen' : 'unseen'} /></span>;
}
export function trackWordsOfferedPresses(ownerDocument: Document, pressRef: React.RefObject<WordsOfferedPress | null>): () => void {
  let onPointerDown = ({ target, isPrimary, pointerType, timeStamp }: PointerEvent) => {
    pressRef.current = {
      beganOnButton: isPrimary && isOnWordsOfferedButton(target),
      cameDownAtMs: pointerType === 'mouse' ? null : timeStamp,
      wasLetGoAtMs: null,
    };
  };
  let onPointerUp = ({ timeStamp }: PointerEvent) => {
    pressRef.current =
      pressRef.current === null
        ? NO_WORDS_OFFERED_PRESS
        : {
            ...pressRef.current,
            wasLetGoAtMs: timeStamp,
          };
  };
  let onPointerCancel = () => {
    pressRef.current = NO_WORDS_OFFERED_PRESS;
  };
  let onClick = () => {
    pressRef.current = null;
  };
  ownerDocument.addEventListener('pointerdown', onPointerDown, true);
  ownerDocument.addEventListener('pointerup', onPointerUp, true);
  ownerDocument.addEventListener('pointercancel', onPointerCancel, true);
  ownerDocument.addEventListener('click', onClick);
  return () => {
    ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
    ownerDocument.removeEventListener('pointerup', onPointerUp, true);
    ownerDocument.removeEventListener('pointercancel', onPointerCancel, true);
    ownerDocument.removeEventListener('click', onClick);
  };
}
export function WordsOfferedButton({ grid, offered, isKeyDrawn, onPressed }: WordsOfferedButtonProps) {
  let pressRef = React.useRef<WordsOfferedPress | null>(null);
  let stopTrackingRef = React.useRef<(() => void) | null>(null);
  let holderRef = React.useCallback((holder: HTMLSpanElement | null) => {
    stopTrackingRef.current?.();
    pressRef.current = null;
    stopTrackingRef.current = holder === null ? null : trackWordsOfferedPresses(holder.ownerDocument, pressRef);
  }, []);
  let placeProps = wordsOfferedPlaceProps(grid);
  if (placeProps === null || offered === null || isKeyDrawn) return null;
  let { style: placeStyle } = placeProps;
  return <><span ref={holderRef} hidden />{offered.isShown &&
        (<span className="sheet-words-offered" data-holds-only-button {...placeProps} style={grid.editorScale > 1
              ? placeStyle
              : {
                  ...placeStyle,
                  maxWidth: placeStyle.minWidth,
                }}><span>{offered.typed}</span><button type="button" tabIndex={-1} className={WORDS_OFFERED_BUTTON_CLASS} aria-label={useSuggestionLabel(offered.offered)} onClick={({ timeStamp }) => {
                if (isWordsOfferedTap(pressRef.current)) onPressed(offered, timeStamp);
              }}><span className="invisible"><RestOfWordsOffered rest={offered.rest} keyIs="leftOut" /></span></button></span>)}</>;
}
export function useWordsOfferedDelayPassed(isOn: boolean, delayMs: number): boolean {
  let [hasDelayPassed, setDelayPassed] = React.useState(false);
  if (!isOn && hasDelayPassed) setDelayPassed(false);
  React.useEffect(() => {
    if (!isOn) return;
    let timer = setTimeout(() => setDelayPassed(true), delayMs);
    return () => clearTimeout(timer);
  }, [isOn, delayMs]);
  return isOn && hasDelayPassed;
}
export function WordsOfferedAnnouncer({ words, hasGone, isKeyDrawn }: WordsOfferedAnnouncerProps) {
  let isGoneLongEnough = useWordsOfferedDelayPassed(hasGone, OFFER_ANNOUNCE_DELAY_MS);
  return <LiveAnnouncer words={words === null ? isGoneLongEnough && suggestionGoneText() : suggestionHeardAs(words, isKeyDrawn)} />;
}
export function useCellEntryFieldEvents(store: Pick<SheetController, 'dispatch'>) {
  let isComposingRef = React.useRef(false);
  return React.useMemo(
    () => ({
      onKeyDown: ({ nativeEvent, keyCode }: React.KeyboardEvent<EntryTextField>) => {
        isComposingRef.current = nativeEvent.isComposing || keyCode === 229;
      },
      onSelect: ({ currentTarget }: React.SyntheticEvent<EntryTextField>) => {
        if (!isCaretAtEndOfField(currentTarget))
          store.dispatch({
            kind: 'wordsOfferedWithdrawn',
          });
      },
      onInput: ({ currentTarget, nativeEvent }: React.FormEvent<EntryTextField>) => {
        let isComposing = isComposingRef.current || ('isComposing' in nativeEvent && nativeEvent.isComposing === true);
        let typedEvent: CellEntryTyped = {
          kind: 'cellEntryTyped',
          text: currentTarget.value,
          isOpenToOffer: !isComposing && isCaretAtEndOfField(currentTarget),
        };
        queueMicrotask(() => store.dispatch(typedEvent));
      },
    }),
    [store],
  );
}
export const WORDS_OFFERED_SHOW_DELAY_MS = 300;
export const doWordsOfferedFit = (
  wordsElement: HTMLElement,
  editorElement: Element,
  { right, bottom, scale }: { right: number; bottom: number; scale: number },
): boolean =>
  wordsElement.scrollWidth <= wordsElement.clientWidth &&
  editorElement.scrollWidth <= editorElement.clientWidth &&
  wordsElement.offsetLeft + wordsElement.offsetWidth * scale <= right &&
  wordsElement.offsetTop + wordsElement.offsetHeight * scale <= bottom;
export const RestOfWordsOffered = ({ rest, keyIs }: RestOfWordsOfferedProps) =>
  <><span className="sheet-rest-of-words-offered text-secondary">{rest}</span>{keyIs !== 'leftOut' &&
        <span className={`sheet-key-that-takes-words ml-1 text-caption ${shortcutKeycapClassName('Tab')} ${keyIs === 'seen' ? '' : 'invisible'}`}>{tabKeyLabel()}</span>}</>;
export const isWordsOfferedKeyDrawn = (offered: WordsOfferedOfPage | null, isKeyDrawnNow: boolean): boolean =>
  offered?.isShown === true ? offered.isKeyDrawn : isKeyDrawnNow;
export const WORDS_OFFERED_BUTTON_CLASS = 'sheet-button-over-words-offered';
export const isOnWordsOfferedButton = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`.${WORDS_OFFERED_BUTTON_CLASS}`) !== null;
export const NO_WORDS_OFFERED_PRESS: WordsOfferedPress = {
  beganOnButton: false,
  cameDownAtMs: null,
  wasLetGoAtMs: null,
};
export const isWordsOfferedTap = (press: WordsOfferedPress | null): boolean =>
  press === null ||
  (press.beganOnButton &&
    (press.cameDownAtMs === null || (press.wasLetGoAtMs !== null && press.wasLetGoAtMs - press.cameDownAtMs <= TAP_HOLD_LIMIT_MS)));
export const isCaretAtEndOfField = (field: EntryTextField): boolean =>
  field.selectionStart === field.value.length && field.selectionEnd === field.value.length;
