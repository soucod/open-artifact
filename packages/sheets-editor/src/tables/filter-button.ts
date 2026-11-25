import { isCellShownBlank } from '../format/shown-text.ts';
import { activeAnchorCell } from '../selection/model.ts';
import { ownFilterAtCell, isOwnFilterDrawn, filterTableAtCell } from './own-filters.ts';
import type { TableToFilter } from './own-filters.ts';
import { filterValueOfCell, isOneCellSelected, isCellInFilterRecords } from './own-filter-actions.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import { hasOtherRanges } from '../selection/several-ranges.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
/** What the filter button does: turn a filter on, or take the one drawn away. */
export type FilterButtonAct = { kind: 'turnOn' } | { kind: 'remove'; tableKey: string };
/** What the filter buttons offer for the active cell: the filter act, and the cell's text to filter by. */
export interface FilterButtonOffer {
  filter: FilterButtonAct;
  /** `null` when filtering by the cell is not offered; `''` for a blank cell. */
  valueOfCell: string | null;
}
export function hasFilledNeighbour(reads: WorkbookReads, cell: CellId): boolean {
  const position = reads.positionOfCell(cell);
  return (
    position !== null &&
    NEIGHBOUR_STEPS.some(([rowStep, columnStep]) => {
      const cellId = reads.cellIdAt(cell.sheetId, position.rowIndex + rowStep, position.columnIndex + columnStep);
      return cellId !== null && !isCellShownBlank(reads.cellOnShowIn(cellId));
    })
  );
}
export function canFilterAtCell(reads: WorkbookReads, ownFilter: TableToFilter | null, cell: CellId): boolean {
  let filter = ownFilter ?? filterTableAtCell(reads, cell);
  if (filter !== null) return isCellInFilterRecords(reads, filter, cell);
  return filterValueOfCell(reads, cell) !== null || hasFilledNeighbour(reads, cell);
}
export function filterButtonOffer(state: PageState, reads: WorkbookReads): FilterButtonOffer | null {
  if (!isNavigatingOneRange(state)) return null;
  const cell = activeAnchorCell(state, reads);
  const ownFilter = ownFilterAtCell(state, reads, cell);
  const isBlank = filterValueOfCell(reads, cell) === null;
  const isValueOffered = isOneCellSelected(state, reads) && canFilterAtCell(reads, ownFilter, cell);
  return {
    filter:
      ownFilter === null || !isOwnFilterDrawn(state, ownFilter)
        ? {
            kind: 'turnOn',
          }
        : {
            kind: 'remove',
            tableKey: ownFilter.key,
          },
    valueOfCell: !isValueOffered ? null : isBlank ? '' : cellShownText(reads.cellOnShowIn(cell), reads.decimalSign),
  };
}
export const NEIGHBOUR_STEPS: [rowStep: number, columnStep: number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
export const isNavigatingOneRange = (state: PageState): boolean => state.mode.kind === 'navigating' && !hasOtherRanges(state);
