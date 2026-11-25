import { Popover } from '../kit/popover.tsx';
import { AgentMark } from '../kit/agent-mark.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { CELL_POPUP_SIDE_OFFSETS } from '../ui/popup-placement.ts';
import { MOUSE_STILL_SLOP } from '../comments/mouse-around.ts';
import { askAgentToFixSelection, askFixInPlace } from '../agent/ask-agent-menu.tsx';
import { useLastNonNull, withListTabStops, isWithinPressGuard, isWithinClickAfterUp } from '../ui/list-under-cell.tsx';
import { useBottomInset, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { useTouchBelowSm } from '../app/media-queries.ts';
import { errorExplanationWords } from '../messages/formula-errors.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
import type { SheetController } from '../state/controller.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { SideOfExplainedCard } from '../grid/cards-place.ts';
import type { ErrorExplanation } from '../messages/formula-errors.ts';
import type { CellExplained } from '../state/explained-under-cell.ts';
import type { AnchorOnPage } from '../chips/people-list-view.tsx';
import type { PopupCollisionPadding } from '../shell/bottom-insets.ts';
import type { trackCellsAddedToChat } from '../agent/added-to-message-notices.tsx';
/** A point in the window's coordinates, as pointer events give it. */
export interface PointInWindow {
  x: number;
  y: number;
}
/** An error cell under the mouse, and where the mouse is on the page. */
export interface ErrorCellPointedAt {
  cell: Element;
  at: PagePoint;
}
/** Follows the mouse over error cells and the error card, and tells the page when it rests on a cell. */
export interface ErrorCardHover {
  /** Returns whether the mouse is on the card. */
  tell(pointed: ErrorCellPointedAt | null, mouseAt?: PointInWindow): boolean;
  cardIs(card: (() => HTMLElement | null) | null, onShut?: () => void, cellBounds?: () => DOMRect): void;
  isAt(mouseAt: PointInWindow | null): void;
  cardIsPutAway(): void;
  mouseIsPressed(): void;
  linkCardIs(isLinkCardShown: boolean): void;
  stop(): void;
}
/** Whether the error card is shown as a card (not only a tooltip) and whether the mouse has left it. */
export interface ErrorCardState {
  of: string | null;
  isCard: boolean;
  hasMouseLeft: boolean;
}
/** The side of its cell the error card is on, kept while the card stays at the same place. */
export interface ErrorCardSide {
  of: string | null;
  side: SideOfExplainedCard;
}
/** A wait for the mouse to rest on a cell. */
interface RestOnCell {
  timer: ReturnType<typeof setTimeout>;
  cell: Element;
  from: PagePoint;
}
/** A press of the card's fix button that is still settling. */
interface FixPressSettling {
  of: string;
  timer: ReturnType<typeof setTimeout>;
}
interface CardPlacement {
  anchor: AnchorOnPage;
  side: 'right' | 'bottom';
  align: 'start';
  sideOffset: number;
  collisionPadding: PopupCollisionPadding;
}
interface ErrorCardProps {
  error: ErrorExplanation | null;
  by: CellExplained['by'] | null;
  cellKey: string | null;
  canPersonEdit: boolean;
  isHeldBack: boolean;
  anchor: AnchorOnPage;
  side: SideOfExplainedCard | null;
  /** Changes whenever the cell moves on the page. */
  placeOfCell: string;
  isFixOffered: boolean;
  isFixedHere: boolean;
  canAttach: boolean;
  mouse: ErrorCardHover;
  /** Returns whether the fix was asked. */
  onFixAsked: (cardOf: string, isFixedHere: boolean) => boolean;
  onPutAway: (cardOf: string) => void;
  /** Returns whether the cells took the wheel. */
  onWheelTurned: (event: WheelEvent) => boolean;
}
export function createErrorCardHover(store: Pick<SheetController, 'dispatch'>): ErrorCardHover {
  let restTimer: RestOnCell | null = null;
  let cellRestedOn: Element | null = null;
  let cardElement: (() => HTMLElement | null) | null = null;
  let onCardShut: (() => void) | undefined;
  let cardBounds: (() => DOMRect) | undefined;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  let isMouseOnCard = false;
  let isLinkCard = false;
  let lastPressMs = Number.NEGATIVE_INFINITY;
  let stopRestTimer = () => {
    if (restTimer !== null) clearTimeout(restTimer.timer);
    restTimer = null;
  };
  let stopLeaveTimer = () => {
    if (leaveTimer !== null) clearTimeout(leaveTimer);
    leaveTimer = null;
  };
  let waitForRestOn = ({ cell, at }: ErrorCellPointedAt) => {
    restTimer = {
      timer: setTimeout(
        () => {
          restTimer = null;
          stopLeaveTimer();
          cellRestedOn = cell;
          store.dispatch({
            kind: 'pointerRested',
            at,
          });
        },
        Math.max(
          lastPressMs + FIX_PRESS_SETTLE_MS - performance.now(),
          isLinkCard || cardElement !== null ? ERROR_CARD_REST_AFTER_CARD_MS : ERROR_CARD_REST_MS,
        ),
      ),
      cell,
      from: at,
    };
  };
  let putCardAway = (isShutTold: boolean = true) => {
    stopLeaveTimer();
    if (cellRestedOn === null) return;
    cellRestedOn = null;
    store.dispatch({
      kind: 'pointerRested',
      at: null,
    });
    if (isShutTold) onCardShut?.();
  };
  let isOverCardOrCell = ({ x, y }: PointInWindow) => {
    let [cardRect, cellRect] = [cardElement?.()?.getBoundingClientRect(), cardBounds?.()];
    return (
      cardRect !== undefined &&
      cellRect !== undefined &&
      x >= Math.min(cardRect.left, cellRect.left) &&
      x <= Math.max(cardRect.right, cellRect.right) &&
      y >= Math.min(cardRect.top, cellRect.top) &&
      y <= Math.max(cardRect.bottom, cellRect.bottom)
    );
  };
  let leaveSoon = (mouseAt: PointInWindow | null = null) => {
    if (cellRestedOn === null) return;
    if (mouseAt !== null && isOverCardOrCell(mouseAt)) stopLeaveTimer();
    leaveTimer ??= setTimeout(putCardAway, ERROR_CARD_LEAVE_MS);
  };
  let isOnCard = ({ x, y }: PointInWindow) => {
    let cardRect = cardElement?.()?.getBoundingClientRect();
    return (
      cardRect !== undefined &&
      x >= cardRect.left - CELL_POPUP_SIDE_OFFSETS.right &&
      x <= cardRect.right &&
      y >= cardRect.top - CELL_POPUP_SIDE_OFFSETS.under &&
      y <= cardRect.bottom + CELL_POPUP_SIDE_OFFSETS.under
    );
  };
  return {
    tell(pointed, mouseAt) {
      if (
        restTimer !== null &&
        restTimer.cell === pointed?.cell &&
        Math.hypot(pointed.at.x - restTimer.from.x, pointed.at.y - restTimer.from.y) <= MOUSE_STILL_SLOP
      )
        return false;
      stopRestTimer();
      if (cardElement !== null) {
        isMouseOnCard = mouseAt !== undefined && isOnCard(mouseAt);
        if (isMouseOnCard || pointed !== null) stopLeaveTimer();
        else leaveSoon(mouseAt);
        if (!isMouseOnCard && pointed !== null && pointed.cell !== cellRestedOn) waitForRestOn(pointed);
        return isMouseOnCard;
      }
      if (cellRestedOn === (pointed?.cell ?? null)) return false;
      let wasRestingOnCell = cellRestedOn !== null;
      let stillOnError = wasRestingOnCell && pointed?.cell.hasAttribute('data-looks-like-error') === true ? pointed : null;
      cellRestedOn = stillOnError?.cell ?? null;
      if (wasRestingOnCell)
        store.dispatch({
          kind: 'pointerRested',
          at: stillOnError?.at ?? null,
        });
      if (stillOnError === null && pointed !== null) waitForRestOn(pointed);
      return false;
    },
    cardIs(card, onShut, cellBounds) {
      cardElement = card;
      onCardShut = onShut;
      cardBounds = cellBounds;
      if (card === null && (isMouseOnCard || leaveTimer !== null)) putCardAway();
      if (card === null) isMouseOnCard = false;
    },
    isAt(mouseAt) {
      if (cardElement === null) return;
      isMouseOnCard = mouseAt !== null && isOnCard(mouseAt);
      if (!isMouseOnCard) return leaveSoon(mouseAt);
      stopRestTimer();
      return stopLeaveTimer();
    },
    cardIsPutAway() {
      stopLeaveTimer();
      cellRestedOn = null;
    },
    mouseIsPressed() {
      stopRestTimer();
      putCardAway(false);
      lastPressMs = performance.now();
    },
    linkCardIs(isLinkCardShown) {
      isLinkCard = isLinkCardShown;
    },
    stop() {
      stopRestTimer();
      stopLeaveTimer();
    },
  };
}
export function useErrorCardHover(store: Pick<SheetController, 'dispatch'>, isLinkCardShown: boolean): ErrorCardHover {
  let hover = React.useMemo(() => createErrorCardHover(store), [store]);
  React.useEffect(() => hover.linkCardIs(isLinkCardShown), [hover, isLinkCardShown]);
  React.useEffect(() => hover.stop, [hover]);
  return hover;
}
export function useCardShownAfterDelay(key: string | null, by: CellExplained['by'] | null): boolean {
  let [shownKey, setShownKey] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (key === null) return;
    let timer = setTimeout(() => setShownKey(key), ERROR_CARD_KEYBOARD_DELAY_MS);
    return () => {
      clearTimeout(timer);
      setShownKey(null);
    };
  }, [key]);
  return by === 'pointer' || shownKey === key;
}
export function askAgentToFixErrorOfCard(
  store: SheetController,
  askComposer: ReturnType<typeof trackCellsAddedToChat>,
  cardOf: string,
): boolean {
  let errorExplained = store.getView().errorExplained;
  if (errorExplained?.cellKey !== cardOf || store.isEventUnfinished()) return false;
  store.dispatch({
    kind: 'fixOfErrorAsked',
    cardOf,
  });
  if (store.getView().selectionByAddress?.range !== errorExplained.cells) return false;
  askAgentToFixSelection(askComposer, store);
  return true;
}
export function fixErrorOfCardHere(store: SheetController, cardOf: string): boolean {
  let errorExplained = store.getView().errorExplained;
  if (errorExplained?.cellKey !== cardOf || !errorExplained.canBeFixedHere || store.isEventUnfinished()) return false;
  return askFixInPlace(store, cardOf);
}
export function nextErrorCardSide(state: ErrorCardSide, of: string | null, side: SideOfExplainedCard | null): ErrorCardSide {
  if (of !== null && of === state.of) return state;
  let next = {
    of,
    side: side ?? state.side,
  };
  return next.of === state.of && next.side === state.side ? state : next;
}
export function nextErrorCardState(state: ErrorCardState, of: string | null, isByPointer: boolean, isFixInCard: boolean): ErrorCardState {
  if (of === null)
    return state.of === null
      ? state
      : {
          ...ERROR_CARD_START_STATE,
          isCard: state.isCard,
        };
  if (of !== state.of)
    return {
      ...ERROR_CARD_START_STATE,
      of,
      isCard: isByPointer && isFixInCard,
    };
  if (state.hasMouseLeft)
    return isByPointer
      ? state
      : {
          ...state,
          hasMouseLeft: false,
        };
  return !state.isCard && isByPointer && isFixInCard
    ? {
        ...state,
        isCard: true,
      }
    : state;
}
export const ERROR_CARD_REST_MS = 100;
export const ERROR_CARD_REST_AFTER_CARD_MS = 300;
export const ERROR_CARD_KEYBOARD_DELAY_MS = 300;
export const ERROR_CARD_LEAVE_MS = 300;
export const FIX_PRESS_SETTLE_MS = 500;
export const errorCellUnderMouse = ({ pointerType, buttons, target }: React.PointerEvent): Element | null =>
  pointerType === 'mouse' && buttons === 0 && target instanceof Element ? target.closest('[data-is-error]') : null;
export const askFixOfErrorCard = (
  store: SheetController,
  askComposer: ReturnType<typeof trackCellsAddedToChat>,
  cardOf: string,
  isFixedHere: boolean,
): boolean =>
  isFixedHere ? fixErrorOfCardHere(store, cardOf) : askAgentToFixErrorOfCard(store, askComposer, cardOf);
export const ERROR_CARD_START_STATE: ErrorCardState = {
  of: null,
  isCard: false,
  hasMouseLeft: false,
};
export const ERROR_CARD_SIDE_START: ErrorCardSide = {
  of: null,
  side: 'right',
};
export const errorCardAfterMouseLeft = ({ of }: ErrorCardState): ErrorCardState => ({
  of,
  isCard: false,
  hasMouseLeft: true,
});
export const ErrorCard = React.memo(function ({
  error,
  by,
  cellKey,
  canPersonEdit,
  isHeldBack,
  anchor,
  side,
  placeOfCell,
  isFixOffered,
  isFixedHere,
  canAttach,
  mouse,
  onFixAsked,
  onPutAway,
  onWheelTurned,
}: ErrorCardProps) {
  let isShownNow = useCardShownAfterDelay(cellKey, by);
  let shownError: ErrorExplanation | null = useLastNonNull(error);
  let bottomInset = useBottomInset();
  let isOpen = error !== null && isShownNow && !isHeldBack;
  let isTouchSmall = useTouchBelowSm();
  let isFixShown = (isFixOffered || isFixedHere) && error?.code !== '#TIMEOUT!';
  let isFixInCard = !isTouchSmall && isFixShown;
  let [cardState, setCardState] = React.useState(ERROR_CARD_START_STATE);
  let nextCardState = nextErrorCardState(cardState, isOpen ? cellKey : null, by === 'pointer', isFixInCard);
  if (nextCardState !== cardState) setCardState(nextCardState);
  let { isCard } = nextCardState;
  let isCardShown: boolean = useLastNonNull(isOpen ? isCard : null) ?? false;
  let cardOf = isOpen && isCard ? cellKey : null;
  let [sideState, setSideState] = React.useState(ERROR_CARD_SIDE_START);
  let nextSideState = nextErrorCardSide(sideState, cardOf === null ? null : `${cardOf} ${placeOfCell} ${bottomInset}`, isOpen ? side : null);
  if (nextSideState !== sideState) setSideState(nextSideState);
  let sideShown = nextSideState.side;
  let cardRef = React.useRef<HTMLDivElement | null>(null);
  let hasCard = cardOf !== null;
  React.useEffect(() => {
    if (!hasCard) return mouse.cardIs(null);
    return mouse.cardIs(
      () => cardRef.current,
      () => setCardState(errorCardAfterMouseLeft),
      () => anchor.getBoundingClientRect(),
    );
  }, [mouse, hasCard, anchor]);
  let fixTimerRef = React.useRef<FixPressSettling | null>(null);
  let finishFixPress = React.useCallback(() => {
    if (fixTimerRef.current === null) return;
    clearTimeout(fixTimerRef.current.timer);
    onPutAway(fixTimerRef.current.of);
    fixTimerRef.current = null;
  }, [onPutAway]);
  React.useEffect(
    () => () => {
      if (fixTimerRef.current !== null) clearTimeout(fixTimerRef.current.timer);
    },
    [],
  );
  let shownAtRef = React.useRef(0);
  React.useLayoutEffect(() => {
    if (cardOf !== null) shownAtRef.current = performance.now();
  }, [cardOf]);
  let pressAtRef = React.useRef<number | null>(null);
  let cardRefCallback = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (element === null) return;
      cardRef.current = element;
      element.parentElement?.style.setProperty('pointer-events', 'none');
      let turnWheel = (event: WheelEvent) => {
        if (onWheelTurned(event)) event.preventDefault();
      };
      element.addEventListener('wheel', turnWheel, {
        passive: false,
      });
      let followMouse = ({ pointerType, clientX, clientY }: PointerEvent) => {
        if (pointerType === 'mouse')
          mouse.isAt({
            x: clientX,
            y: clientY,
          });
      };
      let noteMouseLeft = ({ pointerType }: PointerEvent) => {
        if (pointerType === 'mouse') mouse.isAt(null);
      };
      let ownerDocument = element.ownerDocument;
      ownerDocument.addEventListener('pointermove', followMouse, true);
      ownerDocument.documentElement.addEventListener('pointerleave', noteMouseLeft);
      return () => {
        cardRef.current = null;
        element.removeEventListener('wheel', turnWheel);
        ownerDocument.removeEventListener('pointermove', followMouse, true);
        ownerDocument.documentElement.removeEventListener('pointerleave', noteMouseLeft);
      };
    },
    [onWheelTurned, mouse],
  );
  let errorWords =
    shownError === null
      ? ''
      : <span aria-hidden>{errorExplanationWords(shownError, canPersonEdit)}</span>;
  let placement: CardPlacement = {
    anchor,
    side: sideShown === 'right' ? 'right' : 'bottom',
    align: 'start',
    sideOffset: CELL_POPUP_SIDE_OFFSETS[sideShown],
    collisionPadding: popupCollisionPadding(bottomInset),
  };
  let canFix = (canAttach || isFixedHere) && isFixShown;
  let isFixedHereShown: boolean = useLastNonNull(isOpen ? isFixedHere : null) ?? false;
  return <><Tooltip {...placement} content={errorWords} open={isOpen && isTouchSmall} multiline className="max-w-[320px]" />{withListTabStops(
        (<Popover.Root open={isOpen && !isTouchSmall}><Popover.Popup {...placement} ref={cardRefCallback} data-error-card collisionAvoidance={{
              fallbackAxisSide: 'none',
            }} padding="md" initialFocus={false} finalFocus={false} keepFocus aria-label={sheetMessages.errorInThisCell()} aria-hidden={!isCardShown} className="pointer-events-none flex max-w-[320px] min-w-[240px] flex-col items-start gap-2" onPointerDownCapture={() => {
              let pressedAt = performance.now();
              pressAtRef.current = isWithinPressGuard(shownAtRef.current, pressedAt) ? pressedAt : null;
            }} onClickCapture={(event) => {
              let pressedAt = pressAtRef.current;
              pressAtRef.current = null;
              if (pressedAt === null || !isWithinClickAfterUp(pressedAt, performance.now())) return;
              event.stopPropagation();
              mouse.cardIsPutAway();
              if (cardOf !== null) onPutAway(cardOf);
            }}>{errorWords}{isCardShown &&
                (<Button variant="secondary" size="sm" icon={<AgentMark size={14} {...(!canFix && {
                      color: 'currentColor',
                    })} />} aria-disabled={!canFix} className={`pointer-events-auto ${canFix ? '' : 'opacity-disabled'}`} tabIndex={-1} onMouseDown={preventMouseDownDefault} onClick={(event) => {
                    if (!canFix || cardOf === null || fixTimerRef.current?.of === cardOf) return;
                    finishFixPress();
                    if (!onFixAsked(cardOf, isFixedHereShown)) return;
                    swallowRestOfPress(event);
                    mouse.cardIsPutAway();
                    fixTimerRef.current = {
                      of: cardOf,
                      timer: setTimeout(finishFixPress, FIX_PRESS_SETTLE_MS),
                    };
                  }}>{isFixedHereShown ? sheetMessages.fixWithAgent() : sheetMessages.askAgentToFix()}</Button>)}</Popover.Popup></Popover.Root>),
      )}</>;
});
