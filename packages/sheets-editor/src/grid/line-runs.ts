import type { RowId, SheetId } from '@open-artifact/sheets-core';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { GroupOnGrid } from '../model/workbook.ts';
/** A run of lines that a group covers, and whether it is collapsed. */
export type CollapsibleRun = LineSpan & Pick<GroupOnGrid, 'isCollapsed'>;
export function indexRunsOfIds(order: LineIndex, ids: ReadonlySet<string>, fromIndex: number): LineSpan[] {
  let indices = new Float64Array(ids.size);
  let count = 0;
  for (let lineId of ids) {
    let index = order.indexOf(lineId);
    if (index === null || index < fromIndex) continue;
    indices[count] = index;
    count += 1;
  }
  let sorted = indices.subarray(0, count);
  sorted.sort();
  let runs: LineSpan[] = [];
  for (let index of sorted) {
    let lastRun = runs.at(-1);
    if (lastRun !== undefined && runEnd(lastRun) === index)
      runs[runs.length - 1] = {
        ...lastRun,
        count: lastRun.count + 1,
      };
    else
      runs.push({
        firstIndex: index,
        count: 1,
      });
  }
  return runs;
}
export function mergeIndexRuns(runs: LineSpan[], otherRuns: LineSpan[]): LineSpan[] {
  if (runs.length === 0) return otherRuns;
  if (otherRuns.length === 0) return runs;
  let merged: LineSpan[] = [];
  let [index, otherIndex] = [0, 0];
  for (;;) {
    let [run, otherRun] = [runs[index], otherRuns[otherIndex]];
    let takesRun = run !== undefined && (otherRun === undefined || run.firstIndex <= otherRun.firstIndex);
    let next = takesRun ? run : otherRun;
    if (next === undefined) return merged;
    if (takesRun) index += 1;
    else otherIndex += 1;
    let last = merged.at(-1);
    if (last === undefined || runEnd(last) < next.firstIndex) merged.push(next);
    else
      merged[merged.length - 1] = {
        ...last,
        count: Math.max(runEnd(last), runEnd(next)) - last.firstIndex,
      };
  }
}
export function clipIndexRuns(runs: readonly LineSpan[], clip: LineSpan): LineSpan[] {
  let [low, high] = [0, runs.length];
  while (low < high) {
    let middle = Math.floor((low + high) / 2);
    let middleRun = runs[middle];
    if (middleRun !== undefined && runEnd(middleRun) <= clip.firstIndex) low = middle + 1;
    else high = middle;
  }
  let clipped: LineSpan[] = [];
  for (; low < runs.length; low += 1) {
    let run = runs[low];
    if (run === undefined || run.firstIndex >= runEnd(clip)) break;
    let firstIndex = Math.max(run.firstIndex, clip.firstIndex);
    clipped.push({
      firstIndex,
      count: Math.min(runEnd(run), runEnd(clip)) - firstIndex,
    });
  }
  return clipped;
}
export function groupsNotInsideCollapsed<G extends CollapsibleRun>(groups: readonly G[]): G[] {
  let coveredUntil = 0;
  return groups.filter(({ firstIndex, count, isCollapsed }: G) => {
    if (firstIndex < coveredUntil) return false;
    if (isCollapsed) coveredUntil = firstIndex + count;
    return true;
  });
}
export function collapsedIndexRuns(groups: readonly CollapsibleRun[]): LineSpan[] {
  let runs: LineSpan[] = [];
  for (let { firstIndex, count, isCollapsed } of groupsNotInsideCollapsed(groups)) {
    if (!isCollapsed) continue;
    let last = runs.at(-1);
    if (last !== undefined && last.firstIndex + last.count === firstIndex)
      runs[runs.length - 1] = {
        ...last,
        count: last.count + count,
      };
    else
      runs.push({
        firstIndex,
        count,
      });
  }
  return runs;
}
export const NO_ROWS_OUT_OF_VIEW_BY_FILTERS = new Map<SheetId, Set<RowId>>();
export const runEnd = ({ firstIndex, count }: LineSpan): number => firstIndex + count;
export const NO_OWN_COLLAPSING = new Map<string, boolean>();
export const withOwnCollapsing = <G extends Pick<GroupOnGrid, 'groupId' | 'isCollapsed'>>(
  ownCollapsing: ReadonlyMap<string, boolean>,
  groups: readonly G[],
): readonly G[] =>
  ownCollapsing.size === 0
    ? groups
    : groups.map(
        (group: G): G => ({
          ...group,
          isCollapsed: ownCollapsing.get(group.groupId) ?? group.isCollapsed,
        }),
      );
export const leadingRunCount = ([firstRun]: readonly LineSpan[]): number => (firstRun?.firstIndex === 0 ? firstRun.count : 0);
export const countInIndexRun = (runs: readonly LineSpan[], clip: LineSpan): number =>
  clipIndexRuns(runs, clip).reduce((total: number, { count }: LineSpan) => total + count, 0);
