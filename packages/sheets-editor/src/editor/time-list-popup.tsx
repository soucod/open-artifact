import * as React from 'react';
import { useLastNonNull, ListUnderCell, ListRow, ListRowLabel } from '../ui/list-under-cell.tsx';
import { timesForCellLabel } from '../i18n/menu-labels.ts';
import type { AnchorOnPage } from '../chips/people-list-view.tsx';
import type { TimeListView } from '../view/page-view.ts';
type TimeListRowView = TimeListView['rows'][number];
export interface TimeListPopupProps {
  list: TimeListView | null;
  anchor: AnchorOnPage;
  cellElementId: string | null;
  onRowChosen: (row: number) => void;
  onRowPointedAt: (row: number) => void;
  onShut: (event: Event) => void;
}
export function timeListActiveDescendant({ rows, highlightedRow }: Pick<TimeListView, 'rows' | 'highlightedRow'>): {
  id: string;
  highlightedRowId: string | null;
} {
  let highlighted = highlightedRow === null ? undefined : rows[highlightedRow];
  return {
    id: TIME_LIST_ID,
    highlightedRowId: highlighted === undefined ? null : timeListRowId(highlighted),
  };
}
export const TIME_LIST_ID = 'time-list';
export const timeListRowId = ({ secondOfDay }: Pick<TimeListRowView, 'secondOfDay'>): string => `${TIME_LIST_ID}-${secondOfDay}`;
export const EMPTY_TIME_LIST: TimeListView = {
  cell: '',
  rows: [],
  highlightedRow: null,
};
export const TimeListPopup = React.memo(function ({
  list,
  anchor,
  cellElementId,
  onRowChosen,
  onRowPointedAt,
  onShut,
}: TimeListPopupProps) {
  let { cell, rows, highlightedRow }: TimeListView = useLastNonNull(list) ?? EMPTY_TIME_LIST;
  return <ListUnderCell id={TIME_LIST_ID} isOpen={list !== null} anchor={anchor} cellElementId={cellElementId} label={timesForCellLabel(cell)} className="min-w-[var(--anchor-width)]" onShut={onShut}>{rows.map(
      (row, index) =>
        <ListRow key={row.secondOfDay} id={timeListRowId(row)} placeInList={index + 1} rowsInList={rows.length} isHighlighted={index === highlightedRow} onChosen={() => onRowChosen(index)} onPointedAt={() => onRowPointedAt(index)}><ListRowLabel>{row.shown}</ListRowLabel></ListRow>,
    )}</ListUnderCell>;
});
