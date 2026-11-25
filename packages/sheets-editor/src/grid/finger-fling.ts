import * as React from 'react';
import type { SheetController } from '../state/controller.ts';
import { DRAG_START_DISTANCE } from './geometry.ts';
import type { GridPoint } from './geometry.ts';
import { unzoomLength } from './zoom.ts';
import type { ZoomStore } from './zoom.ts';
import { frameSchedulerOf } from './frame-scheduler.ts';
import type { FrameScheduler } from './frame-scheduler.ts';
/** Where a finger was on screen, and when, in milliseconds. */
export interface FingerSample {
  at: GridPoint;
  atMs: number;
}
/** How a fling feels on a platform: the speeds it does not start under, and ends at. */
export interface FlingFeel {
  restsUpTo: number;
  endsAt: number;
}
/** How far a fling goes in a step, and how fast it goes after it, in pixels per millisecond. */
export interface FlingStep {
  by: GridPoint;
  speed: GridPoint;
}
/** What a finger fling needs of the page it scrolls. */
export interface FingerFlingSetup {
  store: Pick<SheetController, 'dispatch' | 'place'>;
  grid: React.RefObject<Element | null>;
  gridZoom: Pick<ZoomStore, 'now'>;
  isOnApple: boolean;
  atStandstill: (speed: GridPoint) => void;
}
export function flingStepAfter(speed: GridPoint, elapsedMs: number): FlingStep {
  let decay = FLING_DECAY_PER_MS ** elapsedMs;
  let distanceFactor = (decay - 1) / Math.log(FLING_DECAY_PER_MS);
  return {
    by: {
      x: speed.x * distanceFactor,
      y: speed.y * distanceFactor,
    },
    speed: {
      x: speed.x * decay,
      y: speed.y * decay,
    },
  };
}
export function flingSpeedAtLift(
  samples: readonly FingerSample[],
  liftedAtMs: number,
  { restsUpTo, endsAt }: FlingFeel = {} as FlingFeel,
): GridPoint | null {
  let lastSample = samples.at(-1);
  if (lastSample === undefined || liftedAtMs - lastSample.atMs > FLING_LIFT_STALE_MS) return null;
  let weighted = samples.map(
    ({ at, atMs }) => ({
      at,
      ms: atMs - lastSample.atMs,
      weight: Math.exp((atMs - lastSample.atMs) / FLING_SAMPLE_WEIGHT_MS),
    }),
  );
  let weightedSum = (valueOf: (sample: (typeof weighted)[number]) => number) =>
    weighted.reduce((sum, sample) => sum + sample.weight * valueOf(sample), 0);
  let totalWeight = weightedSum(() => 1);
  let [meanMs, meanX, meanY] = [
    weightedSum((sample) => sample.ms) / totalWeight,
    weightedSum((sample) => sample.at.x) / totalWeight,
    weightedSum((sample) => sample.at.y) / totalWeight,
  ];
  let msSpread = weightedSum((sample) => (sample.ms - meanMs) ** 2);
  let [speedX, speedY] = [
    -weightedSum((sample) => (sample.ms - meanMs) * (sample.at.x - meanX)) / msSpread,
    -weightedSum((sample) => (sample.ms - meanMs) * (sample.at.y - meanY)) / msSpread,
  ];
  if (
    Math.max(...samples.map(({ at }) => Math.hypot(at.x - (samples[0]?.at ?? at).x, at.y - (samples[0]?.at ?? at).y))) <
    DRAG_START_DISTANCE
  )
    return null;
  let speed = Math.hypot(speedX, speedY);
  let scale = Math.min((speed - restsUpTo) / FLING_SPEED_RAMP, 1, FLING_MAX_START_SPEED / speed);
  if (!(speed * scale >= endsAt)) return null;
  return {
    x: Math.abs(speedY) >= Math.abs(speedX) * FLING_AXIS_LOCK_RATIO ? 0 : speedX * scale,
    y: Math.abs(speedX) >= Math.abs(speedY) * FLING_AXIS_LOCK_RATIO ? 0 : speedY * scale,
  };
}
export function createFingerFling(
  scrollBy: (by: GridPoint) => void,
  scrollPlace: () => string,
  viewOf: () => FrameScheduler | null,
  zoom: () => number,
  feel: FlingFeel = FLING_FEEL_BY_PLATFORM.onApple,
  onStandstill: (speed: GridPoint) => void = () => {},
) {
  let samples: FingerSample[] = [];
  let frame: { of: FrameScheduler; id: number } | null = null;
  let stopFling = () => {
    let wasFlinging = frame !== null;
    frame?.of.cancelAnimationFrame(frame.id);
    frame = null;
    samples = [];
    return wasFlinging;
  };
  let flingOn = (speed: GridPoint, fromMs: number, fromPlace: string) => {
    let step = (frameAtMs: number) => {
      frame = null;
      if (scrollPlace() !== fromPlace) return;
      if (frameAtMs <= fromMs) return flingOn(speed, fromMs, fromPlace);
      if (frameAtMs - fromMs > FLING_MAX_FRAME_GAP_MS) return;
      let stepped = flingStepAfter(speed, Math.min(frameAtMs - fromMs, FLING_MAX_FRAME_MS));
      scrollBy({
        x: unzoomLength(stepped.by.x, zoom()),
        y: unzoomLength(stepped.by.y, zoom()),
      });
      let placeNow = scrollPlace();
      let isSlowEnough = Math.hypot(stepped.speed.x, stepped.speed.y) < feel.endsAt;
      if (placeNow !== fromPlace && !isSlowEnough) flingOn(stepped.speed, frameAtMs, placeNow);
      if (placeNow === fromPlace) onStandstill(stepped.speed);
      return;
    };
    let view = viewOf();
    frame =
      view === null
        ? null
        : {
            of: view,
            id: view.requestAnimationFrame(step),
          };
  };
  return {
    fingerMovedTo({ clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>, atMs: number) {
      samples = [
        ...samples.filter(
          (sample) => atMs - sample.atMs <= FLING_SAMPLE_WINDOW_MS && atMs - sample.atMs >= FLING_SAMPLE_MIN_GAP_MS,
        ),
        {
          at: {
            x: clientX,
            y: clientY,
          },
          atMs,
        },
      ];
    },
    fingerLifted(
      atMs: number,
      heldBy: GridPoint = {
        x: 0,
        y: 0,
      },
    ) {
      let [liftSpeed, lastSample] = [flingSpeedAtLift(samples, atMs, feel), samples.at(-1)];
      stopFling();
      let nowMs = viewOf()?.performance.now();
      if (liftSpeed === null || lastSample === undefined || nowMs === undefined) return;
      let startSpeed = {
        x: heldBy.x * liftSpeed.x > 0 ? 0 : liftSpeed.x,
        y: heldBy.y * liftSpeed.y > 0 ? 0 : liftSpeed.y,
      };
      if (startSpeed.x === 0 && startSpeed.y === 0) return;
      let lagMs = Math.min(atMs - lastSample.atMs, FLING_MAX_LIFT_LAG_MS);
      flingOn(startSpeed, nowMs - lagMs, scrollPlace());
    },
    stop: stopFling,
  };
}
export function useFingerFling({ store, grid, gridZoom, isOnApple, atStandstill }: FingerFlingSetup) {
  let fling = React.useMemo(
    () =>
      createFingerFling(
        ({ x, y }) =>
          store.dispatch({
            kind: 'wheelTurned',
            deltaX: x,
            deltaY: y,
            isByFinger: true,
          }),
        () => {
          let place = store.place();
          return place === null ? '' : `${place.sheetId} ${place.scrollLeft} ${place.scrollTop}`;
        },
        () => frameSchedulerOf(grid.current),
        gridZoom.now,
        FLING_FEEL_BY_PLATFORM[isOnApple ? 'onApple' : 'elsewhere'],
        atStandstill,
      ),
    [store, grid, gridZoom, isOnApple, atStandstill],
  );
  React.useEffect(() => () => void fling.stop(), [fling]);
  return fling;
}
export const FLING_SAMPLE_WINDOW_MS = 100;
export const FLING_SAMPLE_MIN_GAP_MS = 3;
export const FLING_SAMPLE_WEIGHT_MS = 24;
export const FLING_LIFT_STALE_MS = 50;
export const FLING_FEEL_BY_PLATFORM: Record<'onApple' | 'elsewhere', FlingFeel> = {
  onApple: {
    restsUpTo: 0.2,
    endsAt: 0.02,
  },
  elsewhere: {
    restsUpTo: 0.1,
    endsAt: 0.06,
  },
};
export const FLING_SPEED_RAMP = 0.1;
export const FLING_MAX_START_SPEED = 8;
export const FLING_DECAY_PER_MS = 0.998;
export const FLING_AXIS_LOCK_RATIO = 2;
export const FLING_MAX_FRAME_MS = 64;
export const FLING_MAX_LIFT_LAG_MS = 17;
export const FLING_MAX_FRAME_GAP_MS = 500;
