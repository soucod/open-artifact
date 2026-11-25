import type { CancelableTimer, RunAfter } from '../format/border-pen-hover.ts';
import type { PagePoint } from './page-comments.ts';
/** What a hover timer opens and shuts, how long the pointer rests before it opens, and how long after leaving it shuts. */
export interface HoverOpenTimerHooks {
  open(): void;
  shut(): void;
  restMs: number;
  leaveMs: number;
  after: RunAfter;
}
/** What the mouse around comment marks needs of the page: the preview or card shown, and how to show and hide them. */
export interface CommentPreviewHooks {
  shown(): string | null;
  isCardShown(): boolean;
  isMouseOnShown(): boolean;
  show(handle: string): void;
  showCard(handle: string): void;
  hide(): void;
  after: RunAfter;
}
/** What the page tells of the mouse around comment marks, to show a comment's preview while the mouse rests on it. */
export interface MouseAroundComments {
  isOver(markKey: string | null, point: PagePoint): void;
  hasLeftGrid(isOnPreview: boolean): void;
  hostSaysItIsOnPreview(isOnPreview: boolean): void;
  /** Puts away the preview or card shown, and tells the comment of a card put away. */
  putAway(): string | null;
  putAwayAtDraw(keepCard?: boolean): void;
  isPressedOnCells(point: PagePoint): void;
  isDraggedTo(point: PagePoint): void;
  isLetGo(markKey: string | null): void;
  isPressLost(): void;
  isTappedByFinger(markKey: string, point: PagePoint): void;
  isUp(): boolean;
  stop(): void;
}
/** What a card opened by a tap needs of the host's comment cards. */
export interface CommentCardOnTapHooks {
  cardAskedFor(): string | null;
  mayCome(): boolean;
  hasPageKeyboard(): boolean;
  open(handle: string): void;
  shut(): void;
}
/** A preview about to be shown, of a comment mark, from where the mouse rested. */
interface PreviewToShow extends CancelableTimer {
  of: string;
  from: PagePoint;
  isForCard: boolean;
}
/** A press on a comment mark, and where it began. */
interface PressOnMark {
  of: string;
  at: PagePoint;
}
export function createHoverOpenTimer(hover: HoverOpenTimerHooks) {
  let { open, shut, restMs, leaveMs, after } = hover;
  let openTimer: CancelableTimer | null = null;
  let shutTimer: CancelableTimer | null = null;
  let isMenuOpen = false;
  let hasLeft = false;
  let restPoint = {
    x: 0,
    y: 0,
  };
  let cancelOpen = () => {
    openTimer?.cancel();
    openTimer = null;
  };
  let cancelShut = () => {
    shutTimer?.cancel();
    shutTimer = null;
  };
  let shutAfterLeave = () => {
    if (shutTimer !== null || isMenuOpen) return;
    shutTimer = after(leaveMs, () => {
      shutTimer = null;
      shut();
    });
  };
  return {
    restedOn(x: number, y: number) {
      if (openTimer !== null && Math.hypot(x - restPoint.x, y - restPoint.y) <= 3) return;
      cancelOpen();
      restPoint = {
        x,
        y,
      };
      hasLeft = false;
      openTimer = after(restMs, () => {
        openTimer = null;
        open();
      });
    },
    movedOff: cancelOpen,
    entered() {
      hasLeft = false;
      cancelShut();
    },
    left() {
      hasLeft = true;
      shutAfterLeave();
    },
    menuIsOpen(isOpen: boolean) {
      isMenuOpen = isOpen;
      if (isOpen) cancelShut();
      else if (hasLeft) shutAfterLeave();
    },
    stop() {
      cancelOpen();
      cancelShut();
    },
  };
}
export function createMouseAroundComments(previews: CommentPreviewHooks): MouseAroundComments {
  let {
    shown,
    isCardShown,
    isMouseOnShown,
    show,
    showCard,
    hide,
    after,
  } = previews;
  let isMouseOnPreview = false;
  let hasLeftGrid = false;
  let markUnderMouse: string | null = null;
  let markToIgnore: string | null = null;
  let ignoreNextMark = false;
  let press: PressOnMark | null = null;
  let showTimer: PreviewToShow | null = null;
  let hideTimer: CancelableTimer | null = null;
  let cancelShow = () => {
    showTimer?.cancel();
    showTimer = null;
  };
  let cancelHide = () => {
    hideTimer?.cancel();
    hideTimer = null;
  };
  let hideNow = () => {
    cancelHide();
    if (shown() !== null) hide();
  };
  let showAfterDelay = (markKey: string, point: PagePoint, isForCard: boolean = false) => {
    showTimer = {
      ...after(COMMENT_PREVIEW_SHOW_DELAY_MS, () => {
        showTimer = null;
        hasLeftGrid = false;
        (isForCard ? showCard : show)(markKey);
      }),
      of: markKey,
      from: point,
      isForCard,
    };
  };
  let isCardComing = () => isCardShown() || showTimer?.isForCard === true;
  let putAwayNow = () => {
    let wasMouseOnShown = isMouseOnPreview && isMouseOnShown();
    let shownCard = isCardShown() ? shown() : null;
    let putAway = showTimer?.isForCard === true ? showTimer.of : shownCard;
    cancelShow();
    hideNow();
    [markToIgnore, ignoreNextMark] = [markUnderMouse, wasMouseOnShown];
    return putAway;
  };
  let hideSoon = () => {
    if (shown() === null || isCardShown()) return;
    hideTimer ??= after(COMMENT_PREVIEW_HIDE_DELAY_MS, () => {
      hideTimer = null;
      if (!(isMouseOnPreview && isMouseOnShown())) hideNow();
    });
  };
  return {
    isOver(markKey, point) {
      isMouseOnPreview = false;
      markUnderMouse = markKey;
      press = null;
      if (ignoreNextMark) markToIgnore = markKey;
      ignoreNextMark = false;
      if (markKey !== markToIgnore) markToIgnore = null;
      if (markKey !== null && markKey === shown()) {
        cancelShow();
        cancelHide();
        return;
      }
      hideSoon();
      if (markKey === null || markKey === markToIgnore) return cancelShow();
      if (showTimer?.of === markKey && Math.hypot(point.x - showTimer.from.x, point.y - showTimer.from.y) <= MOUSE_STILL_SLOP) return;
      cancelShow();
      showAfterDelay(markKey, point);
    },
    hasLeftGrid(isOnPreview) {
      hasLeftGrid = true;
      isMouseOnPreview = isOnPreview;
      [markUnderMouse, markToIgnore, ignoreNextMark, press] = [null, null, false, null];
      cancelShow();
      if (isOnPreview) cancelHide();
      hideSoon();
    },
    hostSaysItIsOnPreview(isOnPreview) {
      if (!isOnPreview && isMouseOnPreview) hideSoon();
      if (!isOnPreview || hasLeftGrid) return;
      isMouseOnPreview = true;
      cancelShow();
      cancelHide();
    },
    putAway() {
      press = null;
      return putAwayNow();
    },
    putAwayAtDraw(keepCard = false) {
      if (press === null && !(keepCard && isCardComing())) putAwayNow();
    },
    isPressedOnCells(point) {
      isMouseOnPreview = false;
      press =
        markUnderMouse === null
          ? null
          : {
              of: markUnderMouse,
              at: point,
            };
      if (press === null) putAwayNow();
    },
    isDraggedTo(point) {
      if (press === null || Math.hypot(point.x - press.at.x, point.y - press.at.y) <= MOUSE_STILL_SLOP) return;
      press = null;
      putAwayNow();
    },
    isLetGo(markKey) {
      let pressLetGo = press;
      press = null;
      cancelShow();
      if (pressLetGo === null || markKey !== pressLetGo.of) {
        if (pressLetGo !== null) hideNow();
        [markUnderMouse, markToIgnore, ignoreNextMark] = [markKey, markKey, false];
        return;
      }
      [markUnderMouse, markToIgnore, ignoreNextMark] = [markKey, null, false];
      if (shown() === markKey) return;
      hideNow();
      showAfterDelay(markKey, pressLetGo.at);
    },
    isPressLost() {
      if (press === null) return;
      press = null;
      putAwayNow();
    },
    isTappedByFinger(markKey, point) {
      cancelShow();
      showAfterDelay(markKey, point, true);
    },
    isUp: () => shown() !== null,
    stop() {
      cancelShow();
      hideNow();
    },
  };
}
export function createCommentCardOnTap(cards: CommentCardOnTapHooks) {
  let { cardAskedFor, mayCome, hasPageKeyboard, open, shut } = cards;
  let cardOpenedByTap: string | null = null;
  let cardOfTap = () => {
    if (cardAskedFor() !== cardOpenedByTap) cardOpenedByTap = null;
    return cardOpenedByTap;
  };
  return {
    of: cardOfTap,
    show(markKey: string) {
      if (!mayCome() || cardAskedFor() !== null) return;
      open(markKey);
      if (cardAskedFor() === markKey) cardOpenedByTap = markKey;
    },
    hide() {
      if (cardOfTap() === null) return false;
      if (!hasPageKeyboard()) return true;
      cardOpenedByTap = null;
      shut();
      return true;
    },
    forget() {
      cardOpenedByTap = null;
    },
  };
}
export const MOUSE_STILL_SLOP = 3;
export const COMMENT_PREVIEW_SHOW_DELAY_MS = 300;
export const COMMENT_PREVIEW_HIDE_DELAY_MS = 300;
export const noMouseAroundComments: MouseAroundComments = {
  isOver() {},
  hasLeftGrid() {},
  hostSaysItIsOnPreview() {},
  putAway: () => null,
  putAwayAtDraw() {},
  isPressedOnCells() {},
  isDraggedTo() {},
  isLetGo() {},
  isPressLost() {},
  isTappedByFinger() {},
  isUp: () => false,
  stop() {},
};
