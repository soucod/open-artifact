/**
 * The board's reveal: the page opens under a veil (and a Shell keeps its cover) until the first view is the board as
 * it will stay, rather than an empty canvas at the default camera that then jumps.
 */

import { useBoard } from '../state/board.ts';
import { hasPendingDrawingLooks } from './drawing-looks.ts';

/** The longest the first view is held back to settle. */
export const VIEWPORT_REVEAL_BUDGET_MS = 1500;
/** The longest the reveal waits for fonts. */
const FONTS_BUDGET_MS = 500;
function nextFrame(signal: AbortSignal, deadline: number): Promise<void> {
  return new Promise(resolve => {
    const frame = requestAnimationFrame(finish);
    const timer = setTimeout(finish, Math.max(0, deadline - performance.now()));
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
  });
}

async function decodeImage(img: HTMLImageElement, signal: AbortSignal): Promise<void> {
  if (typeof img.decode === 'function') {
    try { await img.decode(); return; } catch { /* The source may have changed while decoding. */ }
  }
  if (img.complete || signal.aborted) return;
  await new Promise<void>(resolve => {
    img.addEventListener('load', () => resolve(), { once: true, signal });
    img.addEventListener('error', () => resolve(), { once: true, signal });
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * Resolves once the board's first view has settled (or after {@link VIEWPORT_REVEAL_BUDGET_MS}): two frames in a row
 * with the same board and the same pictures in view, those pictures decoded, the drawings' looks painted, and the
 * fonts loaded (waited for at most {@link FONTS_BUDGET_MS}). Until then the page keeps its veil, and a Shell its cover.
 */
export async function waitForViewportReady(signal: AbortSignal): Promise<void> {
  const start = performance.now();
  const deadline = start + VIEWPORT_REVEAL_BUDGET_MS;
  const fontsDeadline = start + FONTS_BUDGET_MS;
  const decodes = new WeakMap<HTMLImageElement, { src: string; current: string; done: boolean }>();
  let previousImages: HTMLImageElement[] = [];
  let previousBoard: ReturnType<typeof useBoard.getState>['board'] | undefined;
  let stableFrames = 0;
  while (!signal.aborted && performance.now() < deadline) {
    await nextFrame(signal, deadline);
    if (signal.aborted) return;
    const board = useBoard.getState().board;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('.wb-elements img')).filter(img => {
      const r = img.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight;
    });
    let stable = board === previousBoard && images.length === previousImages.length &&
      images.every((image, index) => image === previousImages[index]);
    for (const img of images) {
      let decoded = decodes.get(img);
      if (!decoded || decoded.src !== img.src || decoded.current !== img.currentSrc) {
        const job = { src: img.src, current: img.currentSrc, done: false };
        decodes.set(img, job);
        void decodeImage(img, signal).then(() => { job.done = true; });
        decoded = job;
      }
      if (!decoded.done) stable = false;
    }
    const fontsPending = performance.now() < fontsDeadline && document.fonts?.status === 'loading';
    stableFrames = stable && !fontsPending && !hasPendingDrawingLooks() ? stableFrames + 1 : 0;
    // Reveal a stable cached viewport even while its list is in flight. Images added
    // by a server response that has already rendered participate in the same deadline.
    if (stableFrames >= 2) return;
    previousImages = images;
    previousBoard = board;
  }
}
