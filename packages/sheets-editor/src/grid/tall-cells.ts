import { mergedAreaOrCellOf, areaOfPosition } from '../selection/model.ts';
import { layoutOfView } from './layout.ts';
import { frozenRowsHeight, cellsHeightAboveFloats, isRangeInSight } from './geometry.ts';
import { heightCoveredByStickyHeaders } from './sticky-headers.ts';
import { DEFAULT_ROW_HEIGHT } from './cell-metrics-values.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { hasOtherRanges } from '../selection/several-ranges.ts';
import { withCalendarShut } from '../chips/calendar.ts';
import type { MoreOfCellShownDone, PageState } from '../state/initial-state.ts';
import type { PageStep } from '../selection/jumps.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** How far the view scrolls through a cell taller than the room for it: from its top, to its foot, and the room it is seen in. */
export interface TallCellScrollRange {
  atStart: number;
  atEnd: number;
  room: number;
  cell: string;
}
export function tallCellScrollRange(state: PageState, workbook: ReadsWithTextMeasurer): TallCellScrollRange | null {
  let area = mergedAreaOrCellOf(workbook, state.activeCell);
  let layout = layoutOfView(state, workbook);
  if (area === null || state.activeCell.sheetId !== state.sheetId) return null;
  let frozenHeight = frozenRowsHeight(layout);
  let position = {
    rowIndex: area.topRowIndex,
    columnIndex: area.leftColumnIndex,
  };
  let stickyHeight = heightCoveredByStickyHeaders(state, workbook, position, layout);
  let room = Math.max(cellsHeightAboveFloats(state) - frozenHeight - stickyHeight, DEFAULT_ROW_HEIGHT);
  let top = Math.max(layout.rowEdges.startOf(area.topRowIndex), frozenHeight);
  let bottom = layout.rowEdges.startOf(area.topRowIndex + area.rowCount);
  if (bottom - top <= room || !isRangeInSight(area, state, layout, state)) return null;
  let cell = areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(workbook, state.sheetId));
  return {
    atStart: top - frozenHeight - stickyHeight,
    atEnd: bottom - frozenHeight - stickyHeight - room,
    room,
    cell,
  };
}
export function scrollThroughTallCell(state: PageState, workbook: ReadsWithTextMeasurer, direction: PageStep): PageState | null {
  let tall =
    isSelectionOneCell(state, workbook) && !hasOtherRanges(state) && state.placementSelected === null ? tallCellScrollRange(state, workbook) : null;
  if (tall === null) return null;
  let edge = direction === 1 ? tall.atEnd : tall.atStart;
  if (direction * (edge - state.scrollTop) < 1) return null;
  let next = state.scrollTop + direction * Math.max(tall.room - DEFAULT_ROW_HEIGHT, DEFAULT_ROW_HEIGHT);
  let scrollTop = direction === 1 ? Math.min(next, edge) : Math.max(next, edge);
  let lastDone: MoreOfCellShownDone = {
    what: 'moreOfCellShown',
    cell: tall.cell,
  };
  return {
    ...withCalendarShut(state),
    scrollTop,
    lastDone,
  };
}
export function scrollToTallCellStart(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let tall = tallCellScrollRange(state, workbook);
  return tall === null || state.scrollTop <= tall.atStart
    ? state
    : {
        ...state,
        scrollTop: tall.atStart,
      };
}
