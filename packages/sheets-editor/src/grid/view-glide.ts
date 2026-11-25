import type { ShiftOfView } from '../state/controller.ts';
/** One move of the view, played out over time: how far it goes, when it began and how long it takes. */
export interface Glide {
  by: ShiftOfView;
  sinceMs: number;
  takesMs: number;
}
/** The frame asked of a window to glide on. */
export interface GlideFrame {
  of: Window;
  id: number;
}
/** Plays the moves of the view out as glides, frame by frame, and tells how far it is yet to go. */
export interface ViewGlide {
  viewMovedBy(by: ShiftOfView, reach: ShiftOfView, scale: number): void;
  yetToGo(): ShiftOfView | null;
  stop(): void;
}
export function createViewGlide(windowOf: () => Window | null, onMoved: () => void): ViewGlide {
  let glides: Glide[] = [];
  let elapsedMs = 0;
  let lastFrameAt: number | null = null;
  let frame: GlideFrame | null = null;
  let yetToGo: ShiftOfView | null = null;
  let leftAlong = (axis: keyof ShiftOfView): number =>
    Math.round(
      glides.reduce(
        (total: number, { by, sinceMs, takesMs }: Glide = {} as Glide) =>
          total + by[axis] * (1 - easeInOutCubic((elapsedMs - sinceMs) / takesMs)),
        0,
      ),
    ) + 0;
  let leftToGo = (): ShiftOfView | null =>
    glides.length === 0
      ? null
      : {
          x: leftAlong('x'),
          y: leftAlong('y'),
        };
  let stop = () => {
    frame?.of.cancelAnimationFrame(frame.id);
    [glides, elapsedMs, lastFrameAt, frame, yetToGo] = [[], 0, null, null, null];
  };
  let askForFrame = () => {
    let window = windowOf();
    if (window === null) stop();
    else
      frame = {
        of: window,
        id: window.requestAnimationFrame(onFrame),
      };
  };
  function onFrame(at: number) {
    frame = null;
    let sinceLast = lastFrameAt === null ? 0 : Math.max(0, at - lastFrameAt);
    lastFrameAt = at;
    elapsedMs += sinceLast;
    glides = glides.filter(({ sinceMs, takesMs }: Glide = {} as Glide) => elapsedMs < sinceMs + takesMs);
    let before = yetToGo;
    if (glides.length === 0) stop();
    else {
      let left = leftToGo();
      if (left?.x !== before?.x || left?.y !== before?.y) yetToGo = left;
      askForFrame();
    }
    if (yetToGo !== before) onMoved();
  }
  return {
    viewMovedBy(by: ShiftOfView, reach: ShiftOfView, scale: number) {
      if (windowOf() === null) return stop();
      let isBeyondReach = Math.abs(by.x) > reach.x || Math.abs(by.y) > reach.y;
      let clamped = {
        x: clampWithin(by.x, reach.x),
        y: clampWithin(by.y, reach.y),
      };
      let takesMs = glideMsOfDistance(Math.hypot(clamped.x, clamped.y) * scale);
      glides = [
        ...(isBeyondReach ? [] : glides),
        {
          by: clamped,
          sinceMs: elapsedMs,
          takesMs,
        },
      ];
      yetToGo = leftToGo();
      if (frame === null) askForFrame();
      return;
    },
    yetToGo: () => yetToGo,
    stop,
  };
}
export const glideMsOfDistance = (distance: number): number => Math.round(Math.min(900, Math.max(300, 18 * Math.sqrt(distance))));
export const easeInOutCubic = (progress: number): number => {
  let clamped = Math.min(1, Math.max(0, progress));
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2;
};
export const clampWithin = (value: number, reach: number): number => Math.max(-reach, Math.min(reach, value));
