import * as React from 'react';
import { Avatar } from '../kit/avatar.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { Popover, type PopoverPopupProps } from '../kit/popover.tsx';
import { translateMessage } from '../i18n/messages.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { useLastNonNull } from '../ui/list-under-cell.tsx';
import { isRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { popupCollisionPadding, useBarsInsetAtFoot, useBottomInset } from '../shell/bottom-insets.ts';
import type { GuideFromStream, GuideStop } from '../shell/sheet-links.ts';
import type { SheetController } from '../state/controller.ts';
import { goToPlace } from './sheet-link-sync.ts';

type StoreOfWalkthrough = Pick<SheetController, 'getView' | 'dispatch'>;

/** A walkthrough on show: its stops, the one at, and whether the person has yet to be taken to its cells. */
interface WalkOfGuide {
  stops: GuideStop[];
  at: number;
  isUnseen: boolean;
}

interface WalkthroughCardProps {
  guide: GuideFromStream;
  store: StoreOfWalkthrough;
  anchor: PopoverPopupProps['anchor'];
  areCellsLit: boolean;
  isAtEnd: boolean;
  isPersonAtWorkInPage: () => boolean;
  onKeyDown: (event: React.KeyboardEvent<Element>) => void;
  giveCaretBack: () => void;
}

export function clearCellsLinkedTo(store: StoreOfWalkthrough) {
  let shown = store.getView().listedSheets.find(({ isShown }) => isShown);
  if (shown !== undefined)
    store.dispatch({
      kind: 'cellsLinkedTo',
      place: {
        sheetId: shown.sheetId,
        ranges: [],
      },
    });
}

function WalkthroughCardView({ guide, store, anchor, areCellsLit, isAtEnd, isPersonAtWorkInPage, onKeyDown, giveCaretBack }: WalkthroughCardProps) {
  let [walk, setWalk] = React.useState<WalkOfGuide | null>(null);
  let [said, setSaid] = React.useState({
    words: '',
    times: 0,
  });
  React.useEffect(
    () =>
      guide.start((stops, isRestored) => {
        let isUnseen = isRestored || isPersonAtWorkInPage();
        setWalk({
          stops,
          at: 0,
          isUnseen,
        });
        let words = walkthroughMessages.hasCome(document.hasFocus());
        setSaid(({ times }) => ({
          words,
          times: times + 1,
        }));
        let firstStop = stops[0];
        if (firstStop !== undefined && !isUnseen)
          store.dispatch({
            kind: 'cellsLinkedTo',
            place: firstStop.place,
          });
        else if (!isRestored) clearCellsLinkedTo(store);
      }),
    [guide, store, isPersonAtWorkInPage],
  );
  let bottomInset = Math.max(useBottomInset(), useBarsInsetAtFoot());
  let walkShown = useLastNonNull(walk);
  let stepButtonRef = React.useRef<HTMLElement>(null);
  let mustFocusStepButton = React.useRef(false);
  let hasCardFocus = () => stepButtonRef.current?.closest(`[${GUIDE_CARD_ATTRIBUTE}]`)?.matches(':focus-within') === true;
  React.useLayoutEffect(() => {
    if (walk !== null && mustFocusStepButton.current)
      stepButtonRef.current?.focus({
        preventScroll: true,
      });
    mustFocusStepButton.current = false;
  }, [walk]);
  let goToStop = (at: number) => {
    let stop = walk?.stops[at];
    if (walk === null || stop === undefined) return;
    mustFocusStepButton.current = hasCardFocus();
    setWalk({
      ...walk,
      at,
      isUnseen: false,
    });
    goToPlace(store, stop.place);
  };
  let close = () => {
    if (hasCardFocus()) giveCaretBack();
    setWalk(null);
    guide.discard();
    clearCellsLinkedTo(store);
  };
  let isUnseen = walkShown?.isUnseen === true && !areCellsLit;
  let isLastStop = !isUnseen && walkShown !== null && walkShown.at === walkShown.stops.length - 1;
  return <Popover.Root open={walk !== null}><LiveAnnouncer words={walk !== null && said.words} timesSaid={said.times} /><Popover.Popup anchor={anchor} side="bottom" align={isAtEnd ? 'end' : 'start'} sideOffset={WALKTHROUGH_CARD_OFFSET} collisionPadding={popupCollisionPadding(bottomInset)} initialFocus={false} finalFocus={false} keepFocus aria-label={walkthroughMessages.title()} className="flex max-h-[min(280px,var(--available-height))] w-80 max-w-[calc(100vw-16px)] flex-col gap-sm" onKeyDown={(event) => {
        if (isRepeatedEnterOrSpace(event)) return event.preventDefault();
        onKeyDown(event);
        if (event.key === 'Escape') close();
        return;
      }} {...{
        [GUIDE_CARD_ATTRIBUTE]: '',
      }}>{walkShown !== null &&
        <><div className="flex min-w-0 shrink-0 items-center gap-sm"><span aria-hidden className="flex"><Avatar size="xs" variant="agent" name={walkthroughMessages.title()} /></span><span className="min-w-0 flex-1 text-footnote text-secondary tabular-nums">{walkthroughMessages.step(walkShown.at + 1, walkShown.stops.length)}</span><Button variant="ghost" size="sm" iconOnly icon={<Icon name="X" size="sm" />} aria-label={walkthroughMessages.close()} className="shrink-0 text-secondary" onClick={close} /></div><output dir="auto" className="min-h-0 overflow-y-auto text-body wrap-anywhere whitespace-pre-wrap text-primary">{walkShown.stops[walkShown.at]?.words}</output><div className="flex shrink-0 items-center justify-end gap-xs">{!areCellsLit &&
              !isUnseen &&
              <Button variant="ghost" size="sm" className="me-auto" onClick={() => goToStop(walkShown.at)}>{walkthroughMessages.goToCells()}</Button>}{walkShown.at > 0 &&
              <Button variant="ghost" size="sm" onClick={() => goToStop(walkShown.at - 1)}>{walkthroughMessages.back()}</Button>}<Button ref={stepButtonRef} variant="secondary" size="sm" onClick={isLastStop ? close : () => goToStop(walkShown.at + (isUnseen ? 0 : 1))} {...{
                [GUIDE_STEP_ON_ATTRIBUTE]: '',
              }}>{isUnseen
                ? walkthroughMessages.goToCells()
                : isLastStop
                  ? walkthroughMessages.done()
                  : walkthroughMessages.next()}</Button></div></>}</Popover.Popup></Popover.Root>;
}

export const walkthroughMessages = {
  title: () =>
    translateMessage({
      defaultMessage: 'Walkthrough from Agent',
      id: 'M3OuHFIEcK',
    }),
  hasCome: (isPageFocused: boolean) =>
    isPageFocused
      ? translateMessage({
          defaultMessage: 'Agent opened a walkthrough. Press F6 or Shift+F6 until you reach it.',
          id: '9SXhjTafBo',
        })
      : translateMessage({
          defaultMessage: 'Agent opened a walkthrough.',
          id: 'o9PD9m2mwA',
        }),
  step: (step: number, count: number) =>
    translateMessage(
      {
        defaultMessage: '{step} of {count}',
        id: '67gIExcw9L',
      },
      {
        step,
        count,
      },
    ),
  back: () =>
    translateMessage({
      defaultMessage: 'Back',
      id: 'lc9opvu54X',
    }),
  next: () =>
    translateMessage({
      defaultMessage: 'Next',
      id: '6INtX7ZU+d',
    }),
  done: () =>
    translateMessage({
      defaultMessage: 'Done',
      id: 'recfZEZAka',
    }),
  goToCells: () =>
    translateMessage({
      defaultMessage: 'Go to cells',
      id: 'rGygAmzn5t',
    }),
  close: () =>
    translateMessage({
      defaultMessage: 'Close walkthrough',
      id: 'avHNWnGpdA',
    }),
};
export const WALKTHROUGH_CARD_OFFSET = 6;
export const GUIDE_CARD_ATTRIBUTE = 'data-guide-card';
export const GUIDE_STEP_ON_ATTRIBUTE = 'data-step-on';
export const WalkthroughCard = React.memo(WalkthroughCardView);
