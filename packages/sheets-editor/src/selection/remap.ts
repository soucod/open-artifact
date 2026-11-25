import type { IdRun } from '@open-artifact/sheets-core';
import type { LayoutView } from '../grid/layout.ts';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { Place } from '../state/places.ts';
import type { CellArea, CellSelection } from './model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A sheet's lines before a change and now. */
export interface LinesBeforeAndNow {
  before: LineIndex;
  now: LineIndex;
}
/** The indexes of two lines: where a selection starts and where it reaches. */
export type LineIndexPair = [number, number];
export function remapLineSpan(span: LineSpan, isForward: boolean, lines: LinesBeforeAndNow): LineIndexPair | null {
  let { before, now } = lines;
  let stretches = stretchesNowOfSpan(span, lines);
  let endStretch = isForward ? stretches.at(0) : stretches.at(-1);
  if (endStretch === undefined) return null;
  let anchorIndex = isForward ? endStretch.firstIndex : spanEnd(endStretch) - 1;
  let areAdjacent = (earlier: LineSpan, later: LineSpan) =>
    now
      .runsIn({
        firstIndex: spanEnd(earlier),
        count: later.firstIndex - spanEnd(earlier),
      })
      .every((run: IdRun) => before.stretchesOf(run).length === 0);
  let groups: [number, LineSpan][] = [];
  stretches.sort((a: LineSpan, b: LineSpan) => a.firstIndex - b.firstIndex);
  for (let stretch of stretches) {
    let lastGroup = groups.at(-1);
    if (lastGroup !== undefined && areAdjacent(lastGroup[1], stretch)) lastGroup[1] = stretch;
    else groups.push([stretch.firstIndex, stretch]);
  }
  let [groupFirst, groupLast] = groups.find(([, lastStretch]: [number, LineSpan]) => anchorIndex < spanEnd(lastStretch)) ?? [
    anchorIndex,
    endStretch,
  ];
  let [roomBefore, roomAfter] = [anchorIndex - groupFirst, spanEnd(groupLast) - 1 - anchorIndex];
  let extendsForward = roomAfter === roomBefore ? isForward : roomAfter > roomBefore;
  return [anchorIndex, extendsForward ? anchorIndex + roomAfter : groupFirst];
}
export function nearestSurvivingLine(span: LineSpan, lines: LinesBeforeAndNow): number | null {
  let after: LineSpan = {
    firstIndex: spanEnd(span),
    count: lines.before.count - spanEnd(span),
  };
  let firstAfter = stretchesNowOfSpan(after, lines).at(0);
  let lastBefore = stretchesNowOfSpan(
    {
      firstIndex: 0,
      count: span.firstIndex,
    },
    lines,
  ).at(-1);
  return firstAfter?.firstIndex ?? (lastBefore === undefined ? null : spanEnd(lastBefore) - 1);
}
export function remapLinePair(oneIndex: number | null, otherIndex: number | null, lines: LinesBeforeAndNow): LineIndexPair {
  let [fromIndex, toIndex]: LineIndexPair = [oneIndex ?? otherIndex ?? 0, otherIndex ?? oneIndex ?? 0];
  let span = {
    firstIndex: Math.min(fromIndex, toIndex),
    count: Math.abs(toIndex - fromIndex) + 1,
  };
  let lastIndex = lines.now.count - 1;
  let remapped = remapLineSpan(span, fromIndex <= toIndex, lines);
  if (remapped !== null) return remapped;
  let survivor = nearestSurvivingLine(span, lines);
  return survivor === null ? [Math.min(fromIndex, lastIndex), Math.min(toIndex, lastIndex)] : [survivor, survivor];
}
export function remapSelectionCorners(
  { sheetId, activeCell, selectionCorner }: Pick<Place, 'sheetId' | 'activeCell' | 'selectionCorner'>,
  readsBefore: WorkbookReads,
  readsNow: Pick<WorkbookReads, 'linesOf' | 'cellIdAt'>,
): Pick<CellSelection, 'activeCell' | 'selectionCorner'> | null {
  let [linesBefore, linesNow] = [readsBefore.linesOf(sheetId), readsNow.linesOf(sheetId)];
  if (linesBefore === null || linesNow === null) return null;
  let rowPair = remapLinePair(linesBefore.rows.indexOf(activeCell.rowId), linesBefore.rows.indexOf(selectionCorner.rowId), {
    before: linesBefore.rows,
    now: linesNow.rows,
  });
  let columnPair = remapLinePair(linesBefore.columns.indexOf(activeCell.columnId), linesBefore.columns.indexOf(selectionCorner.columnId), {
    before: linesBefore.columns,
    now: linesNow.columns,
  });
  let newActiveCell = readsNow.cellIdAt(sheetId, rowPair[0], columnPair[0]);
  let newSelectionCorner = readsNow.cellIdAt(sheetId, rowPair[1], columnPair[1]);
  return newActiveCell === null || newSelectionCorner === null
    ? null
    : {
        activeCell: newActiveCell,
        selectionCorner: newSelectionCorner,
      };
}
export function isActiveCellFullyInView(
  selection: Pick<Place, 'sheetId' | 'activeCell' | 'scrollLeft' | 'scrollTop'>,
  view: LayoutView & Pick<PageState, 'gridWidth' | 'gridHeight'>,
  reads: ReadsWithTextMeasurer,
): boolean {
  let { sheetId, activeCell } = selection;
  let rowIndex = reads.rowIndexOf(sheetId, activeCell.rowId);
  let columnIndex = reads.columnIndexOf(sheetId, activeCell.columnId);
  if (rowIndex === null || columnIndex === null) return false;
  let area: CellArea = {
    topRowIndex: rowIndex,
    leftColumnIndex: columnIndex,
    rowCount: 1,
    columnCount: 1,
  };
  let layout = layoutOfView(
    {
      ...view,
      sheetId,
      dragging: null,
    },
    reads,
  );
  return isRangeInSight(area, selection, layout, view);
}
export const spanEnd = ({ firstIndex, count }: LineSpan): number => firstIndex + count;
export const stretchesNowOfSpan = (span: LineSpan, { before, now }: LinesBeforeAndNow): LineSpan[] =>
  before.runsIn(span).flatMap((run: IdRun) => now.stretchesOf(run));
