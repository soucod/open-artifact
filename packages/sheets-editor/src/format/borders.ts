import { selectedArea, selectionOfArea, isSameArea } from '../selection/model.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { withNoEffects } from '../state/transitions.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import { NO_COLOR } from '../model/colors.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellArea } from '../selection/model.ts';
import type { Border, BorderStyle, Edges } from '@open-artifact/sheets-core';
/** A choice of the borders menu: the edges to draw a line on, or 'clear' to take every border off. */
export type BorderChoice = Edges | 'clear';
/** The line the border pen draws. */
export type BorderLine = Omit<Extract<Border, { kind: 'line' }>, 'kind'>;
export function drawBordersOnSelection(state: PageState, workbook: WorkbookReads, edges: BorderChoice, penOverride: Partial<BorderLine> = {}) {
  let area = selectedArea(state, workbook);
  let selection = area === null ? null : selectionOfArea(state, workbook, area);
  let cells = selection === null ? null : cellBlockOfSelection(state, workbook, selection);
  if (area === null || cells === null) return withNoEffects(state);
  let touchesMergedArea = workbook.mergedAreasIn(state.sheetId, area).some((mergedArea) => isSameArea(mergedArea, area));
  let queueOptions = {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    leavesEntryOpen: true,
  };
  return edges === 'clear'
    ? queueEdit(
        state,
        {
          kind: 'setBorders',
          cells,
          edges: 'all',
          border: {
            kind: 'none',
          },
        },
        {
          ...queueOptions,
          done: 'bordersCleared',
        },
      )
    : queueEdit(
        state,
        {
          kind: 'setBorders',
          cells,
          edges,
          border: {
            kind: 'line',
            ...state.borderPen,
            ...penOverride,
          },
        },
        {
          ...queueOptions,
          done: showsBordersOnArea(area, touchesMergedArea, edges)
            ? {
                what: 'bordersDrawn',
                edges,
              }
            : null,
        },
      );
}
export const BORDER_EDGE_CHOICES: Edges[] = ['all', 'inner', 'innerHorizontal', 'innerVertical', 'outer', 'left', 'top', 'right', 'bottom'];
export const BORDER_LINE_STYLES: BorderStyle[] = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double'];
export const DEFAULT_BORDER_PEN: BorderLine = {
  style: 'thin',
  color: NO_COLOR,
};
export const showsBordersOnArea = (
  { rowCount, columnCount }: Pick<CellArea, 'rowCount' | 'columnCount'>,
  touchesMergedArea: boolean,
  edges: Edges,
): boolean => {
  if (touchesMergedArea) return !edges.startsWith('inner');
  if (edges === 'inner') return rowCount > 1 || columnCount > 1;
  if (edges === 'innerHorizontal') return rowCount > 1;
  return edges !== 'innerVertical' || columnCount > 1;
};
