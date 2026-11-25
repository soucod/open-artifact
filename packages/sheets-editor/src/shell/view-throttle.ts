/** Passes each view on, but while views come throttled, at most one per `VIEW_CHANGE_THROTTLE_MS`. */
export function throttleViewChanges<View>(onView: (view: View) => void, targetWindow: Window): (view: View, throttled: boolean) => void {
  let pending: { view: View } | null = null;
  let timer: number | undefined;
  let wasThrottled = false;
  return (view, throttled) => {
    let shouldWait = throttled && (!wasThrottled || pending !== null);
    wasThrottled = throttled;
    if (!shouldWait) {
      targetWindow.clearTimeout(timer);
      pending = null;
      onView(view);
      return;
    }
    if (pending === null)
      timer = targetWindow.setTimeout(() => {
        let waiting = pending;
        pending = null;
        if (waiting !== null) onView(waiting.view);
      }, VIEW_CHANGE_THROTTLE_MS);
    pending = {
      view,
    };
  };
}
export const VIEW_CHANGE_THROTTLE_MS = 100;
