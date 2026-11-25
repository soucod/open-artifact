import * as React from 'react';
import {
  newHungCardState,
  cardTopLimit,
  refitHungCard,
  rowFollowingCardY,
  markHungCardDrawn,
  isCardHungAnew,
  hasHungPlaceMoved,
  keepCardOpenPlace,
} from './table-outlines.ts';
import type { CardByButton, CardHungFor, CardOpenPlace, HungCardState } from './table-outlines.ts';
import { useBarsInsetAtFoot, useBottomInsetWhileOpen } from '../shell/bottom-insets.ts';
/** A card to hang beside a table or under a filter button. */
export interface TableCardToHang {
  /** Where the card is anchored on the screen. */
  placeOnScreen: Pick<Element, 'getBoundingClientRect'>;
  /** The table the card is for; `null` while no card is open. */
  tableKey: string | null;
  byButton: CardByButton | null;
  /** Whether the card follows its row as the row moves. */
  goesWithRow?: boolean;
  zoom: number;
  grid: React.RefObject<HTMLElement | null>;
}
/** The point a hung card is placed at, with a count of fits so that the card is placed again after each. */
export interface HungCardAnchor extends Pick<Element, 'getBoundingClientRect'> {
  fits: number;
}
/** Where a hung card goes, the room it keeps clear at the foot, and what to call once a card is drawn. */
export interface HungTableCardPlace {
  anchor: HungCardAnchor;
  clearAtFoot: number;
  noteFirstCardDrawn: (card: HTMLElement | null) => void;
  noteColumnsCardDrawn: (card: HTMLElement | null) => void;
}
/** How a hung card fits: the room it keeps clear at the foot, whether it is over the bars, and how many fits there were. */
interface HungCardFit {
  clearAtFoot: number;
  isOverBars: boolean;
  fits: number;
}
export function measureFullAvailableHeight(element: HTMLElement): number {
  element.style.setProperty(AVAILABLE_HEIGHT_PROPERTY, '100vh');
  const { offsetHeight } = element;
  element.style.removeProperty(AVAILABLE_HEIGHT_PROPERTY);
  return offsetHeight + 1;
}
export function useHungTableCardPlace({
  placeOnScreen,
  tableKey,
  byButton,
  goesWithRow = false,
  zoom,
  grid,
}: TableCardToHang): HungTableCardPlace {
  const placeRef = React.useRef<CardOpenPlace | null>(null);
  const hungForRef = React.useRef<CardHungFor | null>(null);
  const hungRef = React.useRef<HungCardState>(newHungCardState(null));
  const cardRef = React.useRef<HTMLElement | null>(null);
  const bottomInsetRef = React.useRef(0);
  const barsInsetRef = React.useRef(0);
  const [{ clearAtFoot, isOverBars, fits }, setFit] = React.useState<HungCardFit>({
    clearAtFoot: 0,
    isOverBars: false,
    fits: 0,
  });
  const fitCard = React.useCallback(() => {
    const [place, card] = [placeRef.current, cardRef.current];
    const win = card?.isConnected === true ? card.ownerDocument.defaultView : null;
    if (place === null || card === null || win === null || hasAvailableHeightSet(card)) return;
    const gridElement = grid.current;
    const topAtLeast =
      gridElement === null
        ? undefined
        : cardTopLimit(gridElement.getBoundingClientRect().top + gridElement.clientTop, bottomInsetRef.current, barsInsetRef.current);
    const roomHeight = win.innerHeight - bottomInsetRef.current;
    const hung = refitHungCard(hungRef.current, roomHeight, () => measureFullAvailableHeight(card), topAtLeast);
    if (hung === null) return;
    hungRef.current = hung;
    const rowY = goesWithRow ? rowFollowingCardY(hung, roomHeight) : null;
    placeRef.current = {
      ...place,
      y: rowY ?? hung.place.y,
    };
    const clearAtFootNow = hung.place.clearAtFoot === 0 ? 0 : bottomInsetRef.current + hung.place.clearAtFoot;
    setFit(
      (fit) => ({
        clearAtFoot: clearAtFootNow,
        isOverBars: rowY !== null,
        fits: fit.fits + 1,
      }),
    );
  }, [grid, goesWithRow]);
  const noteCardDrawn = React.useCallback(
    (card: HTMLElement | null, isFirstCard: boolean) => {
      if (card === null) return;
      cardRef.current = card;
      hungRef.current = markHungCardDrawn(hungRef.current, isFirstCard);
      fitCard();
    },
    [fitCard],
  );
  const noteFirstCardDrawn = React.useCallback((card: HTMLElement | null) => noteCardDrawn(card, true), [noteCardDrawn]);
  const noteColumnsCardDrawn = React.useCallback((card: HTMLElement | null) => noteCardDrawn(card, false), [noteCardDrawn]);
  const isForTable = tableKey !== null;
  const [isByButton, rowHeightUnderButton, cellOfButton] = [byButton !== null, byButton?.underRowOfHeight ?? null, byButton?.cell ?? null];
  const barsInset = useBarsInsetAtFoot();
  const barsInsetWhileOpen = isForTable ? barsInset : 0;
  const bottomInset = Math.max(useBottomInsetWhileOpen(isForTable, false, isByButton && !goesWithRow), barsInsetWhileOpen);
  React.useLayoutEffect(() => {
    const { y: top } = placeOnScreen.getBoundingClientRect();
    bottomInsetRef.current = bottomInset;
    barsInsetRef.current = barsInsetWhileOpen;
    const isHungAnew =
      tableKey !== null &&
      isCardHungAnew(
        hungForRef.current,
        tableKey,
        cellOfButton === null
          ? null
          : {
              cell: cellOfButton,
            },
      );
    if (tableKey === null) hungForRef.current = null;
    else if (isHungAnew || cellOfButton !== null)
      hungForRef.current = {
        tableKey,
        cellOfButton,
      };
    if (isHungAnew || (goesWithRow && isForTable && hasHungPlaceMoved(hungRef.current, top))) {
      placeRef.current = null;
      setFit(
        (fit) =>
          fit.clearAtFoot === 0 && !fit.isOverBars
            ? fit
            : {
                ...fit,
                clearAtFoot: 0,
                isOverBars: false,
              },
      );
      hungRef.current = newHungCardState(
        isByButton
          ? {
              y: top,
              underRowOfHeight: rowHeightUnderButton === null ? null : rowHeightUnderButton * zoom,
            }
          : null,
      );
    }
    placeRef.current = keepCardOpenPlace(placeRef.current, isForTable, top);
    fitCard();
  }, [
    isForTable,
    tableKey,
    placeOnScreen,
    isByButton,
    rowHeightUnderButton,
    cellOfButton,
    goesWithRow,
    zoom,
    bottomInset,
    barsInsetWhileOpen,
    fitCard,
  ]);
  React.useEffect(() => {
    const win = isForTable ? grid.current?.ownerDocument.defaultView : null;
    win?.addEventListener('resize', fitCard);
    return () => win?.removeEventListener('resize', fitCard);
  }, [isForTable, grid, fitCard]);
  return {
    anchor: React.useMemo(
      () => ({
        fits,
        getBoundingClientRect() {
          const { x, y } = placeOnScreen.getBoundingClientRect();
          return new DOMRect(x, placeRef.current?.y ?? y, 0, 0);
        },
      }),
      [placeOnScreen, fits],
    ),
    clearAtFoot: isOverBars ? 0 : Math.max(barsInset, clearAtFoot),
    noteFirstCardDrawn,
    noteColumnsCardDrawn,
  };
}
export const TABLE_CARD_WIDTH = 320;
export const AVAILABLE_HEIGHT_PROPERTY = '--available-height';
export const hasAvailableHeightSet = (element: HTMLElement): boolean => element.style.getPropertyValue(AVAILABLE_HEIGHT_PROPERTY) !== '';
