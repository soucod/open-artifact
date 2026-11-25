import type { IdRun } from '@open-artifact/sheets-core';
import type { WorkbookReads } from './workbook.ts';

/** Lines (rows or columns) by their positions: the first index and how many. */
export interface LineSpan {
  firstIndex: number;
  count: number;
}

/** A run of line ids where it starts among the lines. */
export interface PlacedRun extends IdRun {
  startIndex: number;
}

/** The rows or columns of a sheet in order, by their ids. */
export interface LineIndex {
  count: number;
  idAt(index: number): string | null;
  indexOf(lineId: string): number | null;
  stretchesOf(run: IdRun): LineSpan[];
  runsIn(span: LineSpan): IdRun[];
}

/** Which side of an own row order: the rows as the person sees them, or as the workbook stores them. */
export type RowOrderSide = 'seen' | 'stored';

/** The rows of a sheet in an order of the person's own, over the span of rows it reorders. */
export interface OwnRowOrder extends LineSpan {
  stored: LineIndex;
  seen: LineIndex;
}

export function countAtOrBelow<T>(items: readonly T[], keyOf: (item: T) => number, target: number): number {
  let [low, high] = [0, items.length];
  while (low < high) {
    let middle = Math.floor((low + high) / 2);
    let item = items[middle];
    if (item !== undefined && keyOf(item) <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function lowerBoundIndex(items: readonly number[], target: number): number {
  let [low, high] = [0, items.length];
  while (low < high) {
    let middle = Math.floor((low + high) / 2);
    if ((items[middle] ?? target) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}
export function parseLineId(lineId: string): IdRun | null {
  let dotIndex = lineId.lastIndexOf('.');
  let numberText = lineId.slice(dotIndex + 1);
  if (dotIndex === -1 || !LINE_ID_NUMBER_PATTERN.test(numberText)) return null;
  return {
    base: lineId.slice(0, dotIndex),
    first: Number(numberText),
    count: 1,
  };
}
export function createLineIndex(runs: readonly IdRun[]): LineIndex {
  let placedRuns: PlacedRun[] = [];
  let runsByBase = new Map<string, PlacedRun[]>();
  let total = 0;
  for (let run of runs) {
    let placedRun = {
      ...run,
      startIndex: total,
    };
    placedRuns.push(placedRun);
    let sameBase = runsByBase.get(run.base);
    if (sameBase === undefined) runsByBase.set(run.base, [placedRun]);
    else sameBase.push(placedRun);
    total += run.count;
  }
  for (let sameBase of runsByBase.values()) sameBase.sort((oneRun: PlacedRun, otherRun: PlacedRun) => oneRun.first - otherRun.first);
  let stretchesOf = ({ base, first, count }: IdRun): LineSpan[] => {
    let runsOfBase = runsByBase.get(base) ?? [];
    let stretches: LineSpan[] = [];
    for (
      let index = Math.max(0, countAtOrBelow(runsOfBase, (run: PlacedRun) => run.first, first) - 1);
      index < runsOfBase.length;
      index += 1
    ) {
      let run = runsOfBase[index];
      if (run === undefined || run.first >= first + count) break;
      let overlapStart = Math.max(first, run.first);
      let overlapCount = Math.min(first + count, run.first + run.count) - overlapStart;
      if (overlapCount > 0)
        stretches.push({
          firstIndex: run.startIndex + overlapStart - run.first,
          count: overlapCount,
        });
    }
    return stretches;
  };
  return {
    count: total,
    idAt(index: number) {
      if (!Number.isInteger(index) || index < 0 || index >= total) return null;
      let run = lastAtOrBefore(placedRuns, ({ startIndex }: PlacedRun) => startIndex, index);
      return run === undefined ? null : `${run.base}.${run.first + index - run.startIndex}`;
    },
    indexOf(lineId: string) {
      let parsed = parseLineId(lineId);
      return parsed === null ? null : (stretchesOf(parsed)[0]?.firstIndex ?? null);
    },
    stretchesOf,
    runsIn({ firstIndex, count }: LineSpan) {
      let runsWithin: IdRun[] = [];
      for (
        let index = Math.max(0, countAtOrBelow(placedRuns, (run: PlacedRun) => run.startIndex, firstIndex) - 1);
        index < placedRuns.length;
        index += 1
      ) {
        let run = placedRuns[index];
        if (run === undefined || run.startIndex >= firstIndex + count) break;
        let overlapStart = Math.max(firstIndex, run.startIndex);
        let overlapCount = Math.min(firstIndex + count, run.startIndex + run.count) - overlapStart;
        if (overlapCount > 0)
          runsWithin.push({
            base: run.base,
            first: run.first + overlapStart - run.startIndex,
            count: overlapCount,
          });
      }
      return runsWithin;
    },
  };
}
export function createCachedLineIndex(runs: readonly IdRun[]): LineIndex {
  let index = createLineIndex(runs);
  let indexById = new Map<string, number | null>();
  return {
    ...index,
    indexOf(lineId: string) {
      let cached = indexById.get(lineId);
      if (cached !== undefined) return cached;
      let lineIndex = index.indexOf(lineId);
      indexById.set(lineId, lineIndex);
      return lineIndex;
    },
  };
}
export function reuseLineIndex(
  previous: LineIndex | undefined,
  runs: readonly IdRun[],
  createIndex: (runs: readonly IdRun[]) => LineIndex = createLineIndex,
): LineIndex {
  let previousRuns = previous?.runsIn({
    firstIndex: 0,
    count: previous.count,
  });
  let isSame =
    previousRuns?.length === runs.length &&
    previousRuns.every((previousRun: IdRun, runIndex: number) => {
      let run = runs[runIndex];
      return run?.base === previousRun.base && run.first === previousRun.first && run.count === previousRun.count;
    });
  return previous !== undefined && isSame ? previous : createIndex(runs);
}
export function rowStretchesIn(side: RowOrderSide, order: OwnRowOrder, span: LineSpan): LineSpan[] {
  let stretches: LineSpan[] = [];
  for (let run of order[side === 'seen' ? 'stored' : 'seen'].runsIn(span))
    for (let stretch of order[side].stretchesOf(run)) {
      let last = stretches.at(-1);
      if (last !== void 0 && lastIndexOfSpan(last) + 1 === stretch.firstIndex)
        stretches[stretches.length - 1] = {
          ...last,
          count: last.count + stretch.count,
        };
      else stretches.push(stretch);
    }
  return stretches;
}
export function mergedSpans(spans: readonly LineSpan[]): LineSpan[] {
  let sorted = [...spans];
  sorted.sort((oneSpan: LineSpan, otherSpan: LineSpan) => oneSpan.firstIndex - otherSpan.firstIndex);
  let merged: LineSpan[] = [];
  for (let span of sorted) {
    let last = merged.at(-1);
    if (last !== void 0 && span.firstIndex <= lastIndexOfSpan(last) + 1)
      merged[merged.length - 1] = {
        ...last,
        count: Math.max(lastIndexOfSpan(last), lastIndexOfSpan(span)) - last.firstIndex + 1,
      };
    else merged.push(span);
  }
  return merged;
}
export function rowSpansIn(side: RowOrderSide, order: OwnRowOrder | null, span: LineSpan): LineSpan[] {
  if (order === null || !spanCutsOwnRowOrder(order, span)) return [span];
  if (span.count === 1) return rowStretchesIn(side, order, span);
  let cached = rowSpansCache.get(order) ?? new Map<string, LineSpan[]>();
  rowSpansCache.set(order, cached);
  let key = `${side} ${span.firstIndex} ${span.count}`;
  let spans = cached.get(key) ?? mergedSpans(rowStretchesIn(side, order, span));
  if (cached.size >= ROW_SPANS_CACHE_SIZE && !cached.has(key)) cached.clear();
  return (cached.set(key, spans), spans);
}
export function wholeRowSpanIn(side: RowOrderSide, order: OwnRowOrder | null, span: LineSpan): LineSpan | null {
  let [first, ...rest] = rowSpansIn(side, order, span);
  return rest.length > 0 ? null : (first ?? span);
}
export function coveringRowSpanIn(side: RowOrderSide, order: OwnRowOrder | null, span: LineSpan): LineSpan {
  let spans = rowSpansIn(side, order, span);
  let [first, last] = [spans[0], spans.at(-1)];
  return first === void 0 || last === void 0
    ? span
    : {
        firstIndex: first.firstIndex,
        count: lastIndexOfSpan(last) - first.firstIndex + 1,
      };
}
export function ownRowOrderFrom(stored: LineIndex, rows: readonly IdRun[], storedThen: LineIndex): OwnRowOrder | 'givenUp' | null {
  let stretches = rows.flatMap((run: IdRun) => stored.stretchesOf(run));
  let merged = mergedSpans(stretches);
  let [first, last] = [merged[0], merged.at(-1)];
  if (first === void 0 || last === void 0) return null;
  let rowsBetween = new Map<number, IdRun[]>();
  for (let [index, span] of merged.entries()) {
    let next = merged[index + 1];
    if (next === void 0) break;
    let gapStart = lastIndexOfSpan(span) + 1;
    let gapRuns = stored.runsIn({
      firstIndex: gapStart,
      count: next.firstIndex - gapStart,
    });
    if (gapRuns.some((run: IdRun) => storedThen.stretchesOf(run).length > 0)) return 'givenUp';
    rowsBetween.set(lastIndexOfSpan(span), gapRuns);
  }
  let end = lastIndexOfSpan(last) + 1;
  let seen = createLineIndex([
    ...stored.runsIn({ firstIndex: 0, count: first.firstIndex }),
    ...stretches.flatMap((stretch: LineSpan) => stored.runsIn(stretch).concat(rowsBetween.get(lastIndexOfSpan(stretch)) ?? [])),
    ...stored.runsIn({ firstIndex: end, count: stored.count - end }),
  ]);
  return {
    stored,
    seen,
    firstIndex: first.firstIndex,
    count: end - first.firstIndex,
  };
}
export const lastAtOrBefore = <T>(items: readonly T[], keyOf: (item: T) => number, target: number): T | undefined =>
  items[Math.max(0, countAtOrBelow(items, keyOf, target) - 1)];
export const LINE_ID_NUMBER_PATTERN = /^(?:0|[1-9]\d*)$/;
export const ownRowOrderOfSheet = (reads: WorkbookReads, sheetId: string): OwnRowOrder | null =>
  reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.ownRowOrder ?? null;
export const lastIndexOfSpan = ({ firstIndex, count }: LineSpan): number => firstIndex + count - 1;
export const spanCutsOwnRowOrder = (order: LineSpan, span: LineSpan): boolean =>
  span.firstIndex <= lastIndexOfSpan(order) &&
  lastIndexOfSpan(span) >= order.firstIndex &&
  (span.firstIndex > order.firstIndex || lastIndexOfSpan(span) < lastIndexOfSpan(order));
export const ROW_SPANS_CACHE_SIZE = 16;
export const rowSpansCache = new WeakMap<OwnRowOrder, Map<string, LineSpan[]>>();
export const rowIndexIn = (side: RowOrderSide, order: OwnRowOrder | null, index: number): number =>
  coveringRowSpanIn(side, order, { firstIndex: index, count: 1 }).firstIndex;
