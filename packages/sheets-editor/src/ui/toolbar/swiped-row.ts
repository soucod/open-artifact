import { prefersReducedMotion } from '../../kit/platform.ts';
import * as React from 'react';
import { getBottomSafeAreaInset } from '../../shell/bottom-insets.ts';
import { isDockedBarChoice } from '../docked-bar.tsx';
import type { DockedBarChoice } from '../docked-bar.tsx';
import { isSyntheticEscape } from '../../app/page-guards.ts';
import { useTopLayerClose } from '../list-under-cell.tsx';
/** Where a row of tools that scrolls sideways sits, and how far it is scrolled. */
export interface ToolRowScroll {
  left: number;
  right: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}
/** Where the row of tools is, which decides whether a menu's choices show in the row in its place. */
export interface ToolRowPlace {
  isSwipedRow: boolean;
  isEntryOpen: boolean;
  isUnderComposer: boolean;
}
export interface SwipedToolRowOptions {
  isSwipedRow: boolean;
  isEntryOpen: boolean;
  /** The menu of the bar that is open, by its tool. */
  openMenu: string | null;
  scrollerRef: React.RefObject<HTMLElement | null>;
  closeMenu: (menu: string) => void;
}
/** The handlers the scrolling row of tools takes, which keep a press near its edges from choosing a tool. */
export interface ToolRowScrollerHandlers {
  onScroll: (event: React.UIEvent<HTMLElement>) => void;
  onPointerDownCapture: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancelCapture: () => void;
  onMouseDownCapture: (event: React.MouseEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
}
export interface SwipedToolRow {
  /** The menu whose choices are shown in the row in place of the tools. */
  choicesInPlace: DockedBarChoice | null;
  goBackToTools: () => void;
  showAllChoices: () => void;
  noteFocusAsChoicesGo: () => void;
  ofScroller: ToolRowScrollerHandlers;
}
export function markToolRowScrollEdges(scroller: Element): void {
  scroller.toggleAttribute('data-has-more-at-start', scroller.scrollLeft > 1);
  scroller.toggleAttribute('data-has-more-at-end', scroller.scrollLeft < scroller.scrollWidth - scroller.clientWidth - 1);
}
export function toolRowScrollForPress(pointerX: number, scroller: ToolRowScroll, isChoicesInPlace: boolean): number | null {
  let maxScroll = scroller.scrollWidth - scroller.clientWidth;
  let pageStep = scroller.clientWidth - 2 * TOOL_ROW_SCROLL_MARGIN_PX;
  if (pointerX > scroller.right - TOOL_ROW_EDGE_PX && scroller.scrollLeft < maxScroll - 1) return Math.min(maxScroll, scroller.scrollLeft + pageStep);
  if (!isChoicesInPlace && pointerX < scroller.left + TOOL_ROW_EDGE_PX && scroller.scrollLeft > 1) return Math.max(0, scroller.scrollLeft - pageStep);
  return null;
}
export function useSwipedToolRow({
  isSwipedRow,
  isEntryOpen,
  openMenu,
  scrollerRef,
  closeMenu,
}: SwipedToolRowOptions): SwipedToolRow {
  let [lastOpenMenu, setLastOpenMenu] = React.useState(openMenu);
  let [choicesShownInRow, setChoicesShownInRow] = React.useState(false);
  if (openMenu !== lastOpenMenu) {
    setLastOpenMenu(openMenu);
    let isUnderComposer = getBottomSafeAreaInset() > 0;
    setChoicesShownInRow(
      showsChoicesInRow(openMenu, {
        isSwipedRow,
        isEntryOpen,
        isUnderComposer,
      }),
    );
  }
  let choicesInPlace = choicesShownInRow && isDockedBarChoice(openMenu) ? openMenu : null;
  React.useLayoutEffect(() => {
    if (choicesInPlace !== null && !isSwipedRow) closeMenu(choicesInPlace);
  }, [choicesInPlace, isSwipedRow, closeMenu]);
  let hadCaretRef = React.useRef(false);
  let noteFocusAsChoicesGo = React.useCallback(() => {
    let scroller = scrollerRef.current;
    hadCaretRef.current = scroller?.contains(scroller.ownerDocument.activeElement) === true;
  }, [scrollerRef]);
  let lastChoicesRef = React.useRef<string | null>(null);
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    let ownerDocument = scroller.ownerDocument;
    if (choicesInPlace !== null) {
      lastChoicesRef.current = choicesInPlace;
      if (scroller.contains(ownerDocument.activeElement))
        scroller.querySelector('button')?.focus({
          preventScroll: true,
        });
      return;
    }
    if (hadCaretRef.current && ownerDocument.activeElement === ownerDocument.body && ownerDocument.hasFocus())
      scroller.querySelector<HTMLElement>(`[data-tool="${lastChoicesRef.current}"] button`)?.focus({
        preventScroll: true,
      });
    hadCaretRef.current = false;
  }, [choicesInPlace, scrollerRef]);
  let pressGuardUntilRef = React.useRef(0);
  let edgeGuardUntilRef = React.useRef(0);
  let toolsScrollLeftRef = React.useRef(0);
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null || !isSwipedRow) return;
    scroller.scrollTo({
      left: choicesInPlace === null ? toolsScrollLeftRef.current : 0,
      behavior: 'instant',
    });
    let pressedButton = choicesInPlace === null ? null : scroller.querySelector('[aria-pressed="true"]');
    let overflowRight =
      pressedButton === null ? 0 : pressedButton.getBoundingClientRect().right - scroller.getBoundingClientRect().right + TOOL_ROW_SCROLL_MARGIN_PX;
    if (overflowRight > 0)
      scroller.scrollTo({
        left: overflowRight,
        behavior: 'instant',
      });
    pressGuardUntilRef.current = nowInWindowOf(scroller) + TOOL_ROW_SCROLL_SETTLE_MS;
  }, [choicesInPlace, isSwipedRow, scrollerRef]);
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (!isSwipedRow || scroller === null) return;
    let observer = new ResizeObserver(() => markToolRowScrollEdges(scroller));
    observer.observe(scroller);
    if (scroller.firstElementChild !== null) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [isSwipedRow, scrollerRef]);
  React.useEffect(() => {
    let view = scrollerRef.current?.ownerDocument.defaultView ?? null;
    if (choicesInPlace === null || view === null) return;
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing || event.keyCode === 229) return;
      if (isSyntheticEscape(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu(choicesInPlace);
    };
    let onBlur = () => closeMenu(choicesInPlace);
    view.addEventListener('keydown', onKeyDown, true);
    view.addEventListener('blur', onBlur);
    return () => {
      view.removeEventListener('keydown', onKeyDown, true);
      view.removeEventListener('blur', onBlur);
    };
  }, [choicesInPlace, closeMenu, scrollerRef]);
  React.useEffect(() => {
    let scroller = scrollerRef.current;
    let view = scroller?.ownerDocument.defaultView ?? null;
    if (choicesInPlace === null || scroller === null || view === null) return;
    let observer = new view.ResizeObserver(() => {
      if (scroller.clientWidth === 0) closeMenu(choicesInPlace);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [choicesInPlace, closeMenu, scrollerRef]);
  let goBackToTools = React.useCallback(() => {
    if (choicesInPlace !== null) closeMenu(choicesInPlace);
  }, [choicesInPlace, closeMenu]);
  let showAllChoices = React.useCallback(() => setChoicesShownInRow(false), []);
  useTopLayerClose(choicesInPlace !== null, goBackToTools);
  let guardedPressRef = React.useRef<boolean | null>(null);
  let guardPress = (event: React.MouseEvent<HTMLElement>) => {
    let scroller = event.currentTarget;
    if (!isSwipedRow || !(event.target instanceof Node) || !scroller.contains(event.target)) return null;
    let wasGuarded = event.type === 'pointerdown' ? null : guardedPressRef.current;
    if (event.type === 'click') guardedPressRef.current = null;
    if (event.type === 'click' && event.detail === 0 && wasGuarded === null) return null;
    let { left, right } = scroller.getBoundingClientRect();
    let { scrollLeft, clientWidth, scrollWidth } = scroller;
    let scrollTarget = toolRowScrollForPress(
      event.clientX,
      {
        left,
        right,
        scrollLeft,
        clientWidth,
        scrollWidth,
      },
      choicesInPlace !== null,
    );
    let isNearEdge = event.clientX > right - TOOL_ROW_EDGE_PX || event.clientX < left + TOOL_ROW_EDGE_PX;
    let isGuarded =
      wasGuarded === true ||
      scrollTarget !== null ||
      nowInWindowOf(scroller) < pressGuardUntilRef.current ||
      (isNearEdge && nowInWindowOf(scroller) < edgeGuardUntilRef.current);
    if (event.type === 'pointerdown') guardedPressRef.current = isGuarded;
    if (!isGuarded) return null;
    event.preventDefault();
    event.stopPropagation();
    return scrollTarget;
  };
  return {
    choicesInPlace,
    goBackToTools,
    showAllChoices,
    noteFocusAsChoicesGo,
    ofScroller: {
      onScroll: ({ currentTarget: scroller }: React.UIEvent<HTMLElement>) => {
        if (choicesInPlace === null) toolsScrollLeftRef.current = scroller.scrollLeft;
        if (isSwipedRow) markToolRowScrollEdges(scroller);
        if (nowInWindowOf(scroller) < edgeGuardUntilRef.current) edgeGuardUntilRef.current = nowInWindowOf(scroller) + TOOL_ROW_SCROLL_SETTLE_MS;
      },
      onPointerDownCapture: guardPress,
      onPointerCancelCapture: () => {
        guardedPressRef.current = null;
      },
      onMouseDownCapture: guardPress,
      onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
        let scrollTarget = guardPress(event);
        if (scrollTarget === null) return;
        event.currentTarget.scrollTo({
          left: scrollTarget,
          behavior: prefersReducedMotion() ? 'instant' : 'smooth',
        });
        edgeGuardUntilRef.current = nowInWindowOf(event.currentTarget) + TOOL_ROW_SCROLL_SETTLE_MS;
      },
    },
  };
}
export const TOOL_ROW_EDGE_PX = 24;
export const TOOL_ROW_SCROLL_MARGIN_PX = 48;
export const TOOL_ROW_SCROLL_SETTLE_MS = 350;
export const nowInWindowOf = (element: Element): number => element.ownerDocument.defaultView?.performance.now() ?? 0;
export const showsChoicesInRow = (openMenu: string | null, where: ToolRowPlace): boolean =>
  where.isSwipedRow && (where.isEntryOpen || where.isUnderComposer) && isDockedBarChoice(openMenu);
