import type { SheetController } from '../state/controller.ts';
import type { PageView } from '../view/page-view.ts';
import * as React from 'react';
/** Swallows a press that lands just after the view moved by itself, when it was most likely aimed at what was there before. */
export interface PressGuardAfterViewMove {
  viewMovedByItself(): void;
  /** Notes a press going down, and tells whether it is swallowed. */
  isPressSwallowed(isPressing: boolean, isOfFinger: boolean): boolean;
  isRestOfPressSwallowed(): boolean;
  isClickSwallowed(isPartOfPress: boolean): boolean;
  isDoubleClickSwallowed(): boolean;
  isMenuSwallowed(): boolean;
}
interface SwallowedPress {
  atMs: number;
  isSoonAfterMove: boolean;
  isOfFinger: boolean;
}
export function createPressGuardAfterViewMove(now: () => number): PressGuardAfterViewMove {
  let viewMovedAtMs: number | null = null;
  let swallowedPress: SwallowedPress | null = null;
  let wasPressSwallowed = false;
  const isSoonAfter = (atMs: number | null) => atMs !== null && now() - atMs < PRESS_AFTER_VIEW_MOVE_MS;
  const isPressSettling = () => swallowedPress !== null && now() - swallowedPress.atMs < SWALLOWED_PRESS_SETTLE_MS;
  return {
    viewMovedByItself: () => void (viewMovedAtMs = now()),
    isPressSwallowed(isPressing: boolean, isOfFinger: boolean) {
      const isSoonAfterMove = isSoonAfter(viewMovedAtMs);
      const isSoonAfterSwallowed = swallowedPress !== null && swallowedPress.isSoonAfterMove && isSoonAfter(swallowedPress.atMs);
      wasPressSwallowed = swallowedPress !== null;
      swallowedPress =
        isPressing && (isSoonAfterMove || isSoonAfterSwallowed)
          ? {
              atMs: now(),
              isSoonAfterMove,
              isOfFinger,
            }
          : null;
      return swallowedPress !== null;
    },
    isRestOfPressSwallowed: () => swallowedPress !== null,
    isClickSwallowed: (isPartOfPress: boolean) =>
      swallowedPress !== null && (isPartOfPress || (swallowedPress.isOfFinger && isPressSettling())),
    isDoubleClickSwallowed: () => swallowedPress !== null || wasPressSwallowed,
    isMenuSwallowed: isPressSettling,
  };
}
export function watchViewMovesByItself(
  store: Pick<SheetController, 'subscribe' | 'getView'>,
  pressGuard: Pick<PressGuardAfterViewMove, 'viewMovedByItself'>,
) {
  let wasGliding = false;
  return store.subscribe(() => {
    const { grid, isFollowingAgent, isFollowingPerson } = store.getView();
    const isGliding = grid.yetToGlide !== null;
    if (isGliding || (wasGliding && (isFollowingAgent || isFollowingPerson))) pressGuard.viewMovedByItself();
    wasGliding = isGliding;
  });
}
export function usePressGuardAfterViewMove(
  store: Pick<SheetController, 'subscribe' | 'getView'>,
  movesOfViewByItself: PageView['movesOfViewByItself'],
  gridRef: React.RefObject<HTMLElement | null>,
) {
  const [pressGuard] = React.useState(() => createPressGuardAfterViewMove(() => performance.now()));
  React.useEffect(() => watchViewMovesByItself(store, pressGuard), [store, pressGuard]);
  React.useLayoutEffect(() => {
    if (movesOfViewByItself === 0) return;
    pressGuard.viewMovedByItself();
    const ownWindow = gridRef.current?.ownerDocument.defaultView ?? null;
    if (ownWindow === null) return;
    const noteFollowing = () => {
      const { isFollowingAgent, isFollowingPerson } = store.getView();
      if (isFollowingAgent || isFollowingPerson) pressGuard.viewMovedByItself();
    };
    let frame = ownWindow.requestAnimationFrame(() => {
      noteFollowing();
      frame = ownWindow.requestAnimationFrame(noteFollowing);
    });
    return () => ownWindow.cancelAnimationFrame(frame);
  }, [store, pressGuard, movesOfViewByItself, gridRef]);
  return pressGuard;
}
export const PRESS_AFTER_VIEW_MOVE_MS = 500;
export const SWALLOWED_PRESS_SETTLE_MS = 1000;
