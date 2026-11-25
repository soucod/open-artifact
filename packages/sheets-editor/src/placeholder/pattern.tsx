/** Whether a motif of the pattern marks the cell at a column and row. */
export type PatternMotif = (column: number, row: number) => boolean;
/** A number from 0 to 1 for each cell, the same each time it is asked. */
export type CellNoise = (column: number, row: number) => number;
/** The pattern as drawn: the columns and rows it was drawn for, its first pass, and how to take it off. */
export interface DrawnPattern {
  cells: string;
  first: number | null;
  takeOff(): void;
}
/** A canvas of the pattern that covers a band of columns, which fade in at the same step. */
interface PatternBand {
  pen: CanvasRenderingContext2D;
  from: number;
  to: number;
  step: number;
  pass: number | null;
}
export let PATTERN_FADE_IN_SECONDS: number;
export let PATTERN_FADE_OUT_SECONDS: number;
export function shufflePatternMotifs(random: () => number, rowCount: number): PatternMotif[] {
  let direction = random() < 0.5 ? 1 : -1;
  let randomOffset = () => Math.floor(random() * 24);
  let [offsetA, offsetB, offsetC, offsetD] = [randomOffset(), randomOffset(), randomOffset(), randomOffset()];
  let [peaksA, peaksB, noise] = [
    localPeaksOfNoise(createCellNoise(random)),
    localPeaksOfNoise(createCellNoise(random)),
    createCellNoise(random),
  ];
  let motifs = [
    (column: number, row: number) => wrapModulo(row + direction * 4 * column + offsetB, 9) === 0,
    (column: number, row: number) => wrapModulo(row + 4 * (2 - Math.abs(wrapModulo(column + offsetC, 4) - 2)) + offsetC, 11) === 0,
    (column: number, row: number) => wrapModulo(row - direction * 2 * column + offsetD, 10) === 0,
    peaksA,
    (column: number, row: number) =>
      peaksB(column, row) && noise(column, row) < 1.05 - 0.95 * (direction === 1 ? row / rowCount : 1 - row / rowCount),
  ].map(
    (motif) => ({
      motif,
      place: random(),
    }),
  );
  motifs.sort((first, second) => first.place - second.place);
  return [
    (column: number, row: number) =>
      wrapModulo(row + 4 * column + offsetA, 16) === 0 || wrapModulo(row - 4 * column + offsetA, 16) === 0,
    ...motifs.map(({ motif }) => motif),
  ];
}
export function drawPlaceholderPattern(element: HTMLElement, previous: DrawnPattern): DrawnPattern {
  let ownerDocument = element.ownerDocument;
  let view = ownerDocument.defaultView;
  if (view === null || view.matchMedia('(prefers-reduced-motion:reduce)').matches) return previous;
  let style = view.getComputedStyle(element);
  let readPixels = (property: string) => Number.parseFloat(style.getPropertyValue(property));
  let headersWidth = readPixels('--sheet-placeholder-headers-width');
  let headersHeight = readPixels('--sheet-placeholder-headers-height');
  let columnWidth = readPixels('--sheet-placeholder-column-width');
  let rowHeight = readPixels('--sheet-placeholder-row-height');
  let { width, height } = element.getBoundingClientRect();
  let rowsUnderHeaders = Math.ceil(headersHeight / rowHeight);
  let columnCount = Math.ceil((width - headersWidth) / columnWidth) + 1;
  let rowCount = Math.ceil((height - headersHeight) / rowHeight) + rowsUnderHeaders;
  let cells = `${columnCount} ${rowCount}`;
  if (!(columnCount > 1 && rowCount > rowsUnderHeaders) || cells === previous.cells) return previous;
  let isFirstDraw = previous.cells === '';
  previous.takeOff();
  let stepOfColumn = (column: number) =>
    Math.round((0.5 + (headersWidth + (column - 0.5) * columnWidth) / width) / 0.16666666666666666);
  let pens: PatternBand[] = [];
  let fades: Animation[] = [];
  for (let index = 0, endColumn = 0; index < columnCount; index = endColumn + 1) {
    endColumn = index;
    while (endColumn + 1 < columnCount && stepOfColumn(endColumn + 1) === stepOfColumn(index)) endColumn += 1;
    let canvas = ownerDocument.createElement('canvas');
    [canvas.width, canvas.height] = [endColumn - index + 1, rowCount];
    canvas.style.top = `${headersHeight - rowsUnderHeaders * rowHeight}px`;
    canvas.style.left = `${headersWidth + (index - 1) * columnWidth}px`;
    canvas.style.width = `${canvas.width * columnWidth}px`;
    canvas.style.height = `${rowCount * rowHeight}px`;
    element.append(canvas);
    fades.push(
      canvas.animate(
        [
          {
            opacity: 0,
            offset: 0,
            easing: 'ease-in-out',
          },
          {
            opacity: 1,
            offset: PATTERN_FADE_IN_SECONDS / 2,
            easing: 'ease-in-out',
          },
          {
            opacity: 0,
            offset: (PATTERN_FADE_IN_SECONDS + PATTERN_FADE_OUT_SECONDS) / 2,
          },
          {
            opacity: 0,
            offset: 1,
          },
        ],
        {
          duration: 2000,
          delay: (stepOfColumn(index) * 0.16666666666666666 - PATTERN_FADE_IN_SECONDS - 4) * 1000,
          iterations: 1 / 0,
        },
      ),
    );
    let pen = canvas.getContext('2d');
    if (pen === null) continue;
    pens.push({
      pen,
      from: index,
      to: endColumn,
      step: stepOfColumn(index),
      pass: null,
    });
  }
  let mount = element.closest('.sheet-placeholder-mount') ?? element.parentElement;
  let shimmers = (
    typeof mount?.getAnimations === 'function'
      ? mount.getAnimations({
          subtree: true,
        })
      : []
  ).filter((animation) => 'animationName' in animation && animation.animationName === 'ui-skeleton-sheen' && animation.playState === 'running');
  if (isFirstDraw) for (let shimmerOfMount of shimmers) shimmerOfMount.startTime = Number(ownerDocument.timeline.currentTime) - 450;
  let [shimmer] = shimmers;
  shimmer?.ready.then(() => {
    for (let fade of fades) if (fade.playState === 'running') fade.startTime = shimmer.startTime;
    return;
  }, ignorePatternOutcome);
  let motifs = shufflePatternMotifs(mulberry32Random(PATTERN_SEED), rowCount);
  let secondsIn = () => Number((shimmer ?? fades[0])?.currentTime ?? 0) / 1000;
  let firstPass = previous.first ?? Math.floor(secondsIn() / 2);
  let paint = (isRedraw: boolean) => {
    for (let band of pens) {
      let cycle = (secondsIn() - (band.step * 0.16666666666666666 - PATTERN_FADE_IN_SECONDS)) / 2;
      let isHidden = (cycle - Math.floor(cycle)) * 2 < PATTERN_FADE_IN_SECONDS + PATTERN_FADE_OUT_SECONDS;
      let pass = Math.floor(cycle) + (isHidden ? 0 : 1);
      if ((isHidden && !isRedraw) || pass === band.pass) continue;
      let motif = motifs[Math.max(0, pass - firstPass) % motifs.length];
      if (motif === undefined) continue;
      band.pass = pass;
      let { pen, from: fromColumn, to: toColumn } = band;
      pen.clearRect(0, 0, toColumn - fromColumn + 1, rowCount);
      pen.fillStyle = style.color;
      for (let column = fromColumn; column <= toColumn; column += 1)
        for (let row = 0; row < rowCount; row += 1) {
          if (!motif(column, Math.max(row, rowsUnderHeaders - 1))) continue;
          for (let alpha of [1, 0.3]) {
            pen.globalAlpha = alpha;
            pen.fillRect(column - fromColumn, row, 1, 1);
          }
        }
    }
  };
  let modeObserver = new view.MutationObserver(() => {
    for (let band of pens) band.pass = null;
    paint(true);
  });
  modeObserver.observe(ownerDocument.documentElement, {
    attributes: true,
    attributeFilter: ['data-mode'],
  });
  let [timer, frame] = [0, 0];
  let schedule = () => {
    view.cancelAnimationFrame(frame);
    frame = view.requestAnimationFrame(() => paint(false));
    timer = view.setTimeout(schedule, ((2 - PATTERN_FADE_IN_SECONDS - PATTERN_FADE_OUT_SECONDS) / 2) * 1000);
  };
  paint(true);
  schedule();
  return {
    cells,
    first: firstPass,
    takeOff() {
      modeObserver.disconnect();
      view.clearTimeout(timer);
      view.cancelAnimationFrame(frame);
      for (let fade of fades) fade.cancel();
      element.replaceChildren();
    },
  };
}
export function PlaceholderPattern() {
  return <div className="sheet-pattern" ref={placeholderPatternRef} aria-hidden />;
}
export const PATTERN_SEED = Math.floor(Math.random() * 4294967296);
[PATTERN_FADE_IN_SECONDS, PATTERN_FADE_OUT_SECONDS] = [0.5, 0.5];
export const mulberry32Random = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 1831565813) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};
export const wrapModulo = (value: number, modulus: number): number => ((value % modulus) + modulus) % modulus;
export const createCellNoise = (random: () => number): CellNoise => {
  let salt = Math.floor(random() * 4294967296);
  return (column: number, row: number) => {
    let hash = Math.imul(column + 101, 2654435761) ^ Math.imul(row + 211, 2246822507) ^ salt;
    hash = Math.imul(hash ^ (hash >>> 15), 739982445);
    hash = Math.imul(hash ^ (hash >>> 12), 695872825);
    return ((hash ^ (hash >>> 15)) >>> 0) / 4294967296;
  };
};
export const localPeaksOfNoise =
  (noise: CellNoise): PatternMotif =>
  (column: number, row: number) => {
    for (let rowStep = -1; rowStep <= 1; rowStep += 1)
      for (let columnStep = -1; columnStep <= 1; columnStep += 1)
        if ((columnStep !== 0 || rowStep !== 0) && noise(column + columnStep, row + rowStep) >= noise(column, row)) return false;
    return true;
  };
export const ignorePatternOutcome = (): void => {
  return;
};
export const PATTERN_RESIZE_DELAY_MS = 150;
export const placeholderPatternRef = (element: HTMLDivElement | null): (() => void) | undefined => {
  let view = element?.ownerDocument.defaultView ?? null;
  if (element === null || view === null) return;
  let pattern: DrawnPattern = {
    cells: '',
    first: null,
    takeOff: ignorePatternOutcome,
  };
  let timer = 0;
  let observer = new view.ResizeObserver(([entry]) => {

    view.clearTimeout(timer);
    if (entry?.contentRect.width === 0) return;
    if (pattern.cells === '') pattern = drawPlaceholderPattern(element, pattern);
    else
      timer = view.setTimeout(() => {
        pattern = drawPlaceholderPattern(element, pattern);
      }, PATTERN_RESIZE_DELAY_MS);
  });
  observer.observe(element);
  return () => {
    observer.disconnect();
    view.clearTimeout(timer);
    pattern.takeOff();
  };
};
