/** Animation frames that still come when the browser holds back `requestAnimationFrame`. */
export interface FrameScheduler {
  performance: Performance;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
}
/** Sets up a second way to reach `onFrame`, for when the frame is held back; gives back how to call it off. */
export type BackupFrameOf = (onFrame: (at: number) => void) => () => void;
export function createFrameScheduler(view: Window, backupFrameOf: BackupFrameOf): FrameScheduler {
  let cancelBackups = new Map<number, () => void>();
  let cancelAnimationFrame = (id: number) => {
    view.cancelAnimationFrame(id);
    cancelBackups.get(id)?.();
    cancelBackups.delete(id);
  };
  return {
    performance: view.performance,
    requestAnimationFrame(callback: FrameRequestCallback) {
      let onFrame = (at: number) => {
        if (!cancelBackups.has(id)) return;
        cancelAnimationFrame(id);
        callback(at);
      };
      let id = view.requestAnimationFrame(onFrame);
      return (cancelBackups.set(id, backupFrameOf(onFrame)), id);
    },
    cancelAnimationFrame,
  };
}
export function frameSchedulerOf(element: Element | null): FrameScheduler | null {
  let view = element?.ownerDocument.defaultView ?? null;
  return element === null || view === null ? null : createFrameScheduler(view, timelineFrameOf(element, view));
}
export const timelineFrameOf =
  (element: Element, { performance }: Pick<Window, 'performance'> = {} as Pick<Window, 'performance'>): BackupFrameOf =>
  (callback) => {
    if (typeof element.animate !== 'function') return () => {};
    let animation = element.animate([], {
      duration: 1,
    });
    animation.startTime = element.ownerDocument.timeline.currentTime;
    animation.onfinish = () => {
      let { currentTime } = element.ownerDocument.timeline;
      callback(typeof currentTime === 'number' ? currentTime : performance.now());
    };
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  };
