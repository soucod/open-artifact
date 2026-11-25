import { prefersReducedMotion } from '../kit/platform.ts';
import type { GridPoint } from '../grid/geometry.ts';
import type { ScrollAlongAxis } from '../grid/scrollbars.tsx';
import * as React from 'react';
/** The control points of a CSS cubic-bezier easing: x1, y1, x2, y2. */
export type CubicBezier = [number, number, number, number];
/** One stretch of a bounce, played from one stretch of the grid to the next. */
export interface BounceLeg {
  from: GridPoint;
  to: GridPoint;
  ms: number;
  curve: CubicBezier;
}
export type BounceLegTiming = Pick<BounceLeg, 'ms' | 'curve'>;
/** Something a bounce moves: the grid, or a margin beside it drawn as lying on it. */
export interface BouncedElement {
  liesOnGrid?: boolean;
  style: CSSStyleDeclaration;
  clientWidth: number;
  clientHeight: number;
  animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => Animation;
}
/** How the grid stretches past its edges when scrolled or flung beyond them, and springs back. */
export interface OverscrollBounce {
  /** Takes back the stretch that a scroll toward the middle undoes, and returns the scroll that is left. */
  easedBy(delta: GridPoint): GridPoint;
  pulledBy(overscroll: GridPoint, delta: GridPoint): void;
  /** Springs back, and returns the way a fling should go after it. */
  letGo(): GridPoint;
  bumpedAt(speed: GridPoint): void;
  isOnWayBack(): boolean;
  heldAgain(): void;
}
interface BouncePlaying {
  legs: BounceLeg[];
  played: Animation[];
}
export function overscrollOnAxis({ by, most }: Pick<ScrollAlongAxis, 'by' | 'most'>, delta: number) {
  const beyond = by + delta - Math.min(Math.max(by + delta, 0), Math.max(most, 0));
  return delta > 0 ? Math.min(Math.max(beyond, 0), delta) : Math.max(Math.min(beyond, 0), delta);
}
export function easedProgress([x1, y1, x2, y2]: CubicBezier, progress: number) {
  let [low, high] = [0, 1];
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (cubicBezierAt(x1, x2, middle) < progress) low = middle;
    else high = middle;
  }
  return cubicBezierAt(y1, y2, (low + high) / 2);
}
export function createOverscrollBounce(
  isOn: boolean,
  elementsOf: () => BouncedElement[],
  zoomOf: () => number,
  now: () => number,
  isMotionReduced: () => boolean = () => false,
): OverscrollBounce {
  if (!isOn) return INERT_OVERSCROLL_BOUNCE;
  let pulled = NO_STRETCH;
  let playing: BouncePlaying | null = null;
  let pullSpeed = NO_STRETCH;
  const roomOf = () => {
    const [first] = elementsOf();
    return first === undefined
      ? NO_STRETCH
      : {
          x: first.clientWidth * zoomOf(),
          y: first.clientHeight * zoomOf(),
        };
  };
  const stretchOfPull = ({ x, y }: GridPoint) => ({
    x: -rubberBandOffset(x, roomOf().x),
    y: -rubberBandOffset(y, roomOf().y),
  });
  const stretchPlayingNow = () => {
    if (playing === null) return NO_STRETCH;
    const startTime = playing.played[0]?.startTime;
    let elapsed = typeof startTime === 'number' ? now() - startTime : 0;
    for (const { from, to, ms, curve } of playing.legs) {
      if (elapsed < ms) {
        const eased = easedProgress(curve, Math.max(elapsed, 0) / ms);
        return {
          x: from.x + (to.x - from.x) * eased,
          y: from.y + (to.y - from.y) * eased,
        };
      }
      elapsed -= ms;
    }
    playing = null;
    return NO_STRETCH;
  };
  const stopPlaying = () => {
    for (const animation of playing?.played ?? []) animation.cancel();
    playing = null;
  };
  const play = (legs: BounceLeg[]) => {
    stopPlaying();
    const duration = legs.reduce((total, { ms }) => total + ms, 0);
    const played = elementsOf().map((element) => {
      Object.assign(element.style, {
        translate: '',
        zIndex: '',
      });
      let offset = 0;
      const keyframes = legs.map(({ from, ms, curve }) => {
        const keyframe = {
          ...stretchStyle(from, element),
          offset,
          easing: `cubic-bezier(${curve.join(', ')})`,
        };
        offset += ms / duration;
        return keyframe;
      });
      return element.animate([...keyframes, stretchStyle(legs.at(-1)?.to ?? NO_STRETCH, element)], {
        duration,
      });
    });
    playing = {
      legs,
      played,
    };
  };
  const drawPulled = () => {
    stopPlaying();
    for (const element of elementsOf())
      Object.assign(
        element.style,
        {
          translate: '',
          zIndex: '',
        },
        isNoStretch(pulled) ? {} : stretchStyle(stretchOfPull(pulled), element),
      );
  };
  const holdAgain = () => {
    const stretch = stretchPlayingNow();
    if (!isStretchShown(stretch)) return;
    pulled = {
      x: pullOfRubberBandOffset(-stretch.x, roomOf().x),
      y: pullOfRubberBandOffset(-stretch.y, roomOf().y),
    };
    drawPulled();
  };
  return {
    easedBy(delta: GridPoint) {
      holdAgain();
      const takenBack = {
        x: stretchTakenBack(delta.x, pulled.x),
        y: stretchTakenBack(delta.y, pulled.y),
      };
      if (isNoStretch(takenBack)) return delta;
      pulled = {
        x: pulled.x + takenBack.x,
        y: pulled.y + takenBack.y,
      };
      drawPulled();
      return {
        x: delta.x - takenBack.x,
        y: delta.y - takenBack.y,
      };
    },
    pulledBy(overscroll: GridPoint, delta: GridPoint) {
      pullSpeed = {
        x: pullSpeed.x * PULL_AXIS_DECAY + Math.abs(delta.x),
        y: pullSpeed.y * PULL_AXIS_DECAY + Math.abs(delta.y),
      };
      const pull = {
        x: pullSpeed.y >= pullSpeed.x * PULL_AXIS_DOMINANCE ? 0 : overscroll.x,
        y: pullSpeed.x >= pullSpeed.y * PULL_AXIS_DOMINANCE ? 0 : overscroll.y,
      };
      if (isNoStretch(pull) || elementsOf().length === 0) return;
      pulled = {
        x: pulled.x + pull.x,
        y: pulled.y + pull.y,
      };
      drawPulled();
    },
    letGo() {
      pullSpeed = NO_STRETCH;
      const stretch = isNoStretch(pulled) ? stretchPlayingNow() : stretchOfPull(pulled);
      if (!isNoStretch(pulled))
        play([
          {
            from: stretch,
            to: NO_STRETCH,
            ...SPRING_BACK_LEG,
          },
        ]);
      pulled = NO_STRETCH;
      return {
        x: flingAfterLetGo(stretch.x),
        y: flingAfterLetGo(stretch.y),
      };
    },
    bumpedAt(speed: GridPoint) {
      const bump = {
        x: bumpOffsetOfSpeed(speed.x),
        y: bumpOffsetOfSpeed(speed.y),
      };
      if (Math.hypot(bump.x, bump.y) < BUMP_MIN_PX || isMotionReduced() || isStretchShown(stretchPlayingNow())) return;
      play([
        {
          from: NO_STRETCH,
          to: bump,
          ...BUMP_OUT_LEG,
        },
        {
          from: bump,
          to: NO_STRETCH,
          ...SPRING_BACK_LEG,
        },
      ]);
    },
    isOnWayBack: () => isStretchShown(stretchPlayingNow()),
    heldAgain: holdAgain,
  };
}
export function useOverscrollBounce(gridRef: React.RefObject<HTMLElement | null>, zoomOf: () => number, isOn: boolean) {
  const bounce = React.useMemo(
    () =>
      createOverscrollBounce(
        isOn,
        () => {
          if (gridRef.current === null) return [];
          const withMargins = gridRef.current.closest('.sheet-with-group-margins');
          const margins = [...(withMargins?.querySelectorAll<HTMLElement>('.sheet-group-margin') ?? [])];
          return [
            gridRef.current,
            ...(withMargins?.querySelectorAll<HTMLElement>('.sheet-import-proposal > *') ?? []),
            ...margins.map(
              (margin) => ({
                liesOnGrid: true,
                style: margin.style,
                clientWidth: margin.clientWidth,
                clientHeight: margin.clientHeight,
                animate: (keyframes: Keyframe[], options: KeyframeAnimationOptions) => margin.animate(keyframes, options),
              }),
            ),
          ];
        },
        zoomOf,
        bounceClockNow,
        prefersReducedMotion,
      ),
    [gridRef, zoomOf, isOn],
  );
  React.useEffect(() => {
    const letGo = () => void bounce.letGo();
    for (const type of ['blur', 'pagehide', 'resize']) window.addEventListener(type, letGo);
    document.addEventListener('visibilitychange', letGo);
    return () => {
      for (const type of ['blur', 'pagehide', 'resize']) window.removeEventListener(type, letGo);
      document.removeEventListener('visibilitychange', letGo);
    };
  }, [bounce]);
  return bounce;
}
export const RUBBER_BAND_FACTOR = 0.5;
export const SPRING_BACK_LEG: BounceLegTiming = {
  ms: 500,
  curve: [0.45, 0.9, 0.45, 0.95],
};
export const BUMP_PX_PER_SPEED_SQUARED = 12.5;
export const BUMP_MAX_PX = 120;
export const BUMP_MIN_PX = 3;
export const BUMP_OUT_LEG: BounceLegTiming = {
  ms: 100,
  curve: [0, 0.6, 0.4, 1],
};
export const PULL_AXIS_DECAY = 0.7;
export const PULL_AXIS_DOMINANCE = 2;
export const STRETCH_SHOWN_PX = 2;
export const rubberBandOffset = (pull: number, room: number) =>
  room <= 0 ? 0 : Math.sign(pull) * (1 - 1 / ((Math.abs(pull) * RUBBER_BAND_FACTOR) / room + 1)) * room;
export const pullOfRubberBandOffset = (offset: number, room: number) =>
  room <= 0 || Math.abs(offset) >= room ? 0 : (Math.sign(offset) * (1 / (1 - Math.abs(offset) / room) - 1) * room) / RUBBER_BAND_FACTOR;
export const overscrollOf = (
  { rows, columns }: Record<'rows' | 'columns', Pick<ScrollAlongAxis, 'by' | 'most'>>,
  delta: GridPoint,
): GridPoint => ({
  x: columns.most <= 0 ? 0 : overscrollOnAxis(columns, delta.x),
  y: overscrollOnAxis(rows, delta.y),
});
export const cubicBezierAt = (p1: number, p2: number, t: number) =>
  3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;
export const stretchTakenBack = (delta: number, pull: number) =>
  delta * pull < 0 ? Math.sign(delta) * Math.min(Math.abs(delta), Math.abs(pull)) : 0;
export const bumpOffsetOfSpeed = (speed: number) =>
  -Math.sign(speed) * Math.min(BUMP_PX_PER_SPEED_SQUARED * speed ** 2, BUMP_MAX_PX);
export const flingAfterLetGo = (stretch: number) => (Math.abs(stretch) > STRETCH_SHOWN_PX ? -Math.sign(stretch) : 0);
export const bounceClockNow = () => performance.now();
export const NO_STRETCH: GridPoint = {
  x: 0,
  y: 0,
};
export const isNoStretch = ({ x, y }: GridPoint) => x === 0 && y === 0;
export const isStretchShown = ({ x, y }: GridPoint) => Math.hypot(x, y) > STRETCH_SHOWN_PX;
export const stretchStyle = ({ x, y }: GridPoint, { liesOnGrid }: Pick<BouncedElement, 'liesOnGrid'>) => ({
  translate: `${x}px ${y}px`,
  ...(liesOnGrid && {
    zIndex: '1',
  }),
});
export const INERT_OVERSCROLL_BOUNCE: OverscrollBounce = {
  easedBy: (delta: GridPoint) => delta,
  pulledBy: () => {},
  letGo: () => NO_STRETCH,
  bumpedAt: () => {},
  isOnWayBack: () => false,
  heldAgain: () => {},
};
