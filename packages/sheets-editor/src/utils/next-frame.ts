export function afterNextFrameOrTimeout(targetWindow: Window, act: () => void, timeoutMs: number = 100): void {
  let hasRun = false;
  let runOnce = () => {
    if (hasRun) return;
    hasRun = true;
    act();
  };
  targetWindow.requestAnimationFrame(() => void targetWindow.setTimeout(runOnce));
  targetWindow.setTimeout(runOnce, timeoutMs);
}
