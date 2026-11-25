import { lastAtOrBefore, type LineSpan } from './line-ids.ts';

/** Where the rows or columns of a sheet start and how large they are, in pixels. */
export interface LineSizes {
  totalSize: number;
  startOf(index: number): number;
  sizeOf(index: number): number;
  indexAt(pixel: number): number;
}

/** Lines given one size. */
export interface SizedRun extends LineSpan {
  sizeInPixels: number;
}

/** A place to scroll to: a line, and how many pixels past its start. */
export interface ScrollPosition {
  index: number;
  pixelsPast: number;
}

interface SizedStretch extends SizedRun {
  start: number;
}

interface HiddenStretch extends LineSpan {
  seam: number;
  sizeGoneBy: number;
}
export function createLineSizes(count: number, sizedRuns: readonly SizedRun[], defaultSize: number): LineSizes {
  let stretches: SizedStretch[] = [];
  let [nextIndex, nextStart] = [0, 0];
  let addStretch = (lineCount: number, sizeInPixels: number) => {
    if (lineCount === 0) return;
    stretches.push({
      firstIndex: nextIndex,
      count: lineCount,
      sizeInPixels,
      start: nextStart,
    });
    nextIndex += lineCount;
    nextStart += lineCount * sizeInPixels;
  };
  for (let sizedRun of sizedRuns) {
    if (sizedRun.firstIndex < nextIndex) throw Error('a row or column was given two sizes');
    addStretch(sizedRun.firstIndex - nextIndex, defaultSize);
    addStretch(sizedRun.count, sizedRun.sizeInPixels);
  }
  if (nextIndex > count) throw Error('a row or column past the last was given a size');
  addStretch(count - nextIndex, defaultSize);
  let stretchAt = (index: number) =>
    lastAtOrBefore(stretches, ({ firstIndex }: SizedStretch) => firstIndex, index);
  return {
    totalSize: nextStart,
    startOf(index: number) {
      let stretch = stretchAt(index);
      if (stretch === undefined) return 0;
      return stretch.start + (index - stretch.firstIndex) * stretch.sizeInPixels;
    },
    sizeOf: (index: number) => stretchAt(index)?.sizeInPixels ?? defaultSize,
    indexAt(pixel: number) {
      if (pixel < 0) return -1;
      let stretch = lastAtOrBefore(stretches, ({ start }: SizedStretch) => start, pixel);
      if (stretch === undefined || pixel >= nextStart) return count;
      return stretch.firstIndex + Math.floor((pixel - stretch.start) / stretch.sizeInPixels);
    },
  };
}
export function collapseLineSizes(sizes: LineSizes, hiddenRuns: readonly LineSpan[]): LineSizes {
  if (hiddenRuns.length === 0) return sizes;
  let hiddenStretches: HiddenStretch[] = [];
  let sizeGone = 0;
  for (let { firstIndex, count: lineCount } of hiddenRuns) {
    let start = sizes.startOf(firstIndex);
    let seam = start - sizeGone;
    sizeGone += sizes.startOf(firstIndex + lineCount) - start;
    hiddenStretches.push({
      firstIndex,
      count: lineCount,
      seam,
      sizeGoneBy: sizeGone,
    });
  }
  let hiddenStretchAt = (index: number) => {
    let stretch = lastAtOrBefore(hiddenStretches, ({ firstIndex }: HiddenStretch) => firstIndex, index);
    return stretch === undefined || index < stretch.firstIndex ? null : stretch;
  };
  let isInside = (index: number, { firstIndex, count }: HiddenStretch) => index < firstIndex + count;
  return {
    totalSize: sizes.totalSize - sizeGone,
    startOf(index: number) {
      let stretch = hiddenStretchAt(index);
      if (stretch === null) return sizes.startOf(index);
      return isInside(index, stretch) ? stretch.seam : sizes.startOf(index) - stretch.sizeGoneBy;
    },
    sizeOf(index: number) {
      let stretch = hiddenStretchAt(index);
      return stretch !== null && isInside(index, stretch) ? 0 : sizes.sizeOf(index);
    },
    indexAt(pixel: number) {
      let stretch = lastAtOrBefore(hiddenStretches, ({ seam }: HiddenStretch) => seam, pixel);
      return sizes.indexAt(stretch === undefined || pixel < stretch.seam ? pixel : pixel + stretch.sizeGoneBy);
    },
  };
}
export function shownLineAtOrBefore(sizes: LineSizes, index: number): number {
  if (index < 0) return -1;
  return isLineShown(sizes, index) ? index : sizes.indexAt(sizes.startOf(index) - 1);
}
export function nearestShownLine(sizes: LineSizes, count: number, index: number, direction: number): number {
  let [after, before] = [shownLineAtOrAfter(sizes, index), shownLineAtOrBefore(sizes, index)];
  if (direction < 0) return before >= 0 ? before : after;
  return after < count ? after : before;
}
export function scrollPositionAtPixel(sizes: LineSizes, pixel: number): ScrollPosition {
  let clampedPixel = Math.max(0, Math.min(Math.round(pixel), sizes.totalSize - 1));
  let index = sizes.indexAt(clampedPixel);
  return {
    index,
    pixelsPast: clampedPixel - sizes.startOf(index),
  };
}
export function lineNextToScrollPosition(sizes: LineSizes, position: ScrollPosition, side: 'before' | 'after'): number | null {
  let positionAtPixel = scrollPositionAtPixel(sizes, pixelOfScrollPosition(sizes, position));
  if (side === 'before') {
    let before = positionAtPixel.pixelsPast > 0 ? positionAtPixel.index : shownLineAtOrBefore(sizes, positionAtPixel.index - 1);
    return before < 0 ? null : before;
  }
  let after = shownLineAtOrAfter(sizes, positionAtPixel.index + 1);
  return sizes.startOf(after) < sizes.totalSize ? after : null;
}
export const MIN_COLUMN_WIDTH = 8;
export const MAX_COLUMN_WIDTH = 2000;
export const MIN_ROW_HEIGHT = 8;
export const MAX_ROW_HEIGHT = 2000;
export const isLineShown = (sizes: LineSizes, index: number): boolean => sizes.sizeOf(index) > 0;
export const shownLineAtOrAfter = (sizes: LineSizes, index: number): number => sizes.indexAt(sizes.startOf(index));
export const pixelOfScrollPosition = (sizes: LineSizes, { index, pixelsPast }: ScrollPosition): number =>
  sizes.startOf(index) + pixelsPast;
export const clampPixelsPast = (sizes: LineSizes, { index, pixelsPast }: ScrollPosition): number =>
  Math.max(0, Math.min(pixelsPast, sizes.totalSize - 1 - sizes.startOf(index)));
