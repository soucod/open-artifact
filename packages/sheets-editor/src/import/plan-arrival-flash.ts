import { useUiWindow } from '../kit/theme.tsx';
import * as React from 'react';
/** What the import dialog drew, which tells whether a plan arrived. */
export interface PlanArrivalDrawn {
  isOpen: boolean;
  isAwaited: boolean;
  isWishOut: boolean;
  plansHeardCount: number;
}
type CancelTimer = () => void;
export interface PlanArrivalFlashTimers {
  afterMs(ms: number, run: () => void): CancelTimer;
  atNextFrame(run: () => void): CancelTimer;
  onChange(isOn: boolean): void;
}
export interface PlanArrivalFlash {
  drawn(drawnState: PlanArrivalDrawn): void;
  isOn(): boolean;
  stop(): void;
}
export function createPlanArrivalFlash({ afterMs, atNextFrame, onChange }: PlanArrivalFlashTimers): PlanArrivalFlash {
  let lastDrawn: PlanArrivalDrawn | null = null;
  let cancelFlash: CancelTimer | null = null;
  let flash = () => {
    let wasOn = cancelFlash !== null;
    cancelFlash?.();
    cancelFlash = atNextFrame(() => {
      cancelFlash = afterMs(PLAN_ARRIVAL_FLASH_MS, () => {
        cancelFlash = null;
        onChange(false);
      });
    });
    if (!wasOn) onChange(true);
  };
  return {
    drawn(drawnState) {
      let isSame =
        lastDrawn?.isOpen === drawnState.isOpen &&
        lastDrawn.isAwaited === drawnState.isAwaited &&
        lastDrawn.plansHeardCount === drawnState.plansHeardCount &&
        !(lastDrawn.isWishOut && !drawnState.isWishOut);
      lastDrawn = drawnState;
      if (drawnState.isOpen && !isSame) flash();
    },
    isOn: () => cancelFlash !== null,
    stop() {
      cancelFlash?.();
      cancelFlash = null;
      lastDrawn = null;
    },
  };
}
export function usePlanArrivalFlash({
  isOpen,
  isAwaited,
  isWishOut,
  plansHeardCount,
}: PlanArrivalDrawn) {
  let pageWindow = useUiWindow();
  let [isOn, setOn] = React.useState(false);
  let flash = React.useMemo(
    () =>
      pageWindow === undefined
        ? null
        : createPlanArrivalFlash({
            afterMs: (ms, run) => {
              let timer = pageWindow.setTimeout(run, ms);
              return () => pageWindow.clearTimeout(timer);
            },
            atNextFrame: (run) => {
              let frame = pageWindow.requestAnimationFrame(run);
              return () => pageWindow.cancelAnimationFrame(frame);
            },
            onChange: setOn,
          }),
    [pageWindow],
  );
  React.useEffect(() => () => flash?.stop(), [flash]);
  React.useLayoutEffect(() => {
    flash?.drawn({
      isOpen,
      isAwaited,
      isWishOut,
      plansHeardCount,
    });
  }, [flash, isOpen, isAwaited, isWishOut, plansHeardCount]);
  let isOnNow = React.useCallback(() => flash?.isOn() ?? false, [flash]);
  return React.useMemo(
    () => ({
      isOn,
      isOnNow,
    }),
    [isOn, isOnNow],
  );
}
export const PLAN_ARRIVAL_FLASH_MS = 400;
