import { tablesInSightOf, hasTableHeadings, isTableCertain } from '../tables/finding.ts';
import { headingTextAt } from '../ui/sort-menu.ts';
import { trimAreaToShownRows } from '../tables/filtered-rows.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea } from '../selection/model.ts';
/** A column of a table in sight that one can go to: its heading and its body cells on show. */
export interface ColumnToGoTo {
  heading: string;
  cells: CellArea;
}
export function tableColumnOffers(state: PageState, workbook: ReadsWithTextMeasurer): ColumnToGoTo[] {
  let { sheetId } = state;
  let room = MAX_COLUMN_OFFERS;
  return tablesInSightOf(state, workbook).flatMap(({ table, header, body, columns }) => {
    if (body === null || room === 0 || !hasTableHeadings(table)) return [];
    let count = Math.min(columns.last - columns.first + 1, room);
    room -= count;
    return Array.from(
      {
        length: count,
      },
      (_, offset): ColumnToGoTo => {
        let columnIndex = columns.first + offset;
        let heading = headingTextAt(
          state,
          workbook,
          {
            rowIndex: header.last,
            columnIndex,
          },
          isTableCertain(table),
        );
        let area: CellArea = {
          topRowIndex: body.first,
          leftColumnIndex: columnIndex,
          rowCount: body.last - body.first + 1,
          columnCount: 1,
        };
        return {
          heading,
          cells: trimAreaToShownRows(state, workbook, area, sheetId),
        };
      },
    ).filter(({ heading }) => heading !== '');
  });
}
export const MAX_COLUMN_OFFERS = 100;
