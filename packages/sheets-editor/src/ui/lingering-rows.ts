import * as React from 'react';
import { OFF_SCREEN_TOP } from '../view/page-view.ts';
import type { DrawnCell, DrawnRow } from '../grid/grid-drawing.tsx';
/** A row that scrolled off screen and stays drawn for a while, for a screen reader still reading it. */
export interface LingeringRow {
  row: DrawnRow;
  /** The pages turned when the row left the screen. */
  leftAt: number;
  /** The row's cells as they were when it left, when it held the active cell. */
  saidOfActiveCell: string | null;
}
/** The rows drawn and the rows that linger after leaving the screen. */
export interface LingeringRowsState {
  rows: DrawnRow[];
  pagesTurned: number;
  lingering: LingeringRow[];
  isTimeUp: boolean;
}
export function lingeringStillDue(
  lingering: LingeringRow[],
  { rows, pagesTurned, isTimeUp }: Pick<LingeringRowsState, 'rows' | 'pagesTurned' | 'isTimeUp'>,
): LingeringRow[] {
  let offScreenRows = offScreenRowsByKey(rows);
  let kept = lingering.filter(
    ({ row, leftAt, saidOfActiveCell }) =>
      (!isTimeUp && pagesTurned - leftAt < LINGER_PAGE_TURNS) ||
      (saidOfActiveCell !== null && saidOfActiveCell === cellsSignatureOf(offScreenRows.get(row.key))),
  );
  return kept.length === lingering.length ? lingering : kept;
}
export function lingeringAfterTimeUp(state: LingeringRowsState): LingeringRowsState {
  let offScreenRows = offScreenRowsByKey(state.rows);
  return {
    ...state,
    isTimeUp: true,
    lingering: lingeringStillDue(state.lingering, {
      ...state,
      isTimeUp: true,
    }).map(({ row, leftAt, saidOfActiveCell }) => {
      let keysStillDrawn = offScreenRows.get(row.key)?.cells.map(({ key }) => key) ?? [];
      let cellsStillDrawn = row.cells.filter(({ key }) => keysStillDrawn.includes(key));
      return {
        row: rowWithCells(row, cellsStillDrawn),
        leftAt,
        saidOfActiveCell,
      };
    }),
  };
}
export function lingeringAfterRows(state: LingeringRowsState, rows: DrawnRow[], pagesTurned: number): LingeringRowsState {
  if (rows === state.rows && pagesTurned === state.pagesTurned) return state;
  if (pagesTurned === state.pagesTurned) {
    if (state.lingering.length === 0)
      return {
        ...state,
        rows,
      };
    return rowsOnScreenSignature(rows) === rowsOnScreenSignature(state.rows)
      ? {
          ...state,
          rows,
          lingering: lingeringStillDue(state.lingering, {
            ...state,
            rows,
          }),
        }
      : {
          ...state,
          rows,
          lingering: [],
        };
  }
  let keysOnScreen = new Set(rows.filter(isRowOnScreen).map(({ key }) => key));
  let offScreenRows = offScreenRowsByKey(rows);
  let next = {
    rows,
    pagesTurned,
    isTimeUp: false,
  };
  let justLeft = state.rows.filter(isRowOnScreen).map(
    (row) => ({
      row: rowMovedOffScreen(row),
      leftAt: pagesTurned,
      saidOfActiveCell: cellsSignatureOf(offScreenRows.get(row.key)),
    }),
  );
  return {
    ...next,
    lingering: lingeringStillDue([...state.lingering, ...justLeft], next).filter(({ row }) => !keysOnScreen.has(row.key)),
  };
}
export function lingeringCellUpdated(cell: DrawnCell, cellNow: DrawnCell | undefined): DrawnCell {
  let isActive = cellNow !== undefined;
  let elementId = cellNow?.elementId ?? null;
  let isBehindBars = !isActive && cell.isBehindBars;
  return cell.isActive === isActive && cell.elementId === elementId && cell.isBehindBars === isBehindBars
    ? cell
    : {
        ...cell,
        isActive,
        elementId,
        isBehindBars,
      };
}
export function rowsWithLingering({ rows, lingering }: Pick<LingeringRowsState, 'rows' | 'lingering'>): DrawnRow[] {
  if (lingering.length === 0) return rows;
  let offScreenRows = offScreenRowsByKey(rows);
  let lingeringRows = lingering.map(({ row }) => {
    let rowNow = offScreenRows.get(row.key);
    let cellNowOf = (cell: DrawnCell) => rowNow?.cells.find(({ key }) => key === cell.key);
    let cells = row.cells.map((cell) => lingeringCellUpdated(cell, cellNowOf(cell)));
    if (rowNow === undefined) return rowWithCells(row, cells);
    let cellsOnlyNow = rowNow.cells.filter(
      ({ key }) => row.cells.every((cell) => cell.key !== key),
    );
    return {
      ...row,
      isBehindBars: rowNow.isBehindBars,
      isNumberBehindBars: rowNow.isNumberBehindBars,
      cells:
        cellsOnlyNow.length === 0
          ? cells
          : [...cells, ...cellsOnlyNow].toSorted((a, b) => a.columnNumber - b.columnNumber),
    };
  });
  let lingeringKeys = new Set(lingeringRows.map(({ key }) => key));
  return [...rows.filter(({ key }) => !lingeringKeys.has(key)), ...lingeringRows].toSorted(
    (a, b) => a.rowNumber - b.rowNumber,
  );
}
export function useLingeringRows(rows: DrawnRow[], pagesTurned: number, isOn: boolean): DrawnRow[] {
  let [state, setState] = React.useState<LingeringRowsState>({
    rows,
    pagesTurned,
    lingering: [],
    isTimeUp: false,
  });
  let stateNow = isOn ? lingeringAfterRows(state, rows, pagesTurned) : state;
  if (stateNow !== state) setState(stateNow);
  let isLingering = stateNow.lingering.length > 0;
  React.useEffect(() => {
    if (!isLingering) return;
    let timer = setTimeout(
      () => setState((current) => (current.pagesTurned === pagesTurned ? lingeringAfterTimeUp(current) : current)),
      LINGER_MS,
    );
    return () => clearTimeout(timer);
  }, [isLingering, pagesTurned]);
  return isOn ? rowsWithLingering(stateNow) : rows;
}
export const LINGER_MS = 1e4;
export const LINGER_PAGE_TURNS = 2;
export const isRowOnScreen = ({ top }: Pick<DrawnRow, 'top'>): boolean => top > OFF_SCREEN_TOP / 2;
export const rowMovedOffScreen = (row: DrawnRow): DrawnRow => ({
  ...row,
  top: OFF_SCREEN_TOP,
});
export const rowWithCells = (row: DrawnRow, cells: DrawnCell[]): DrawnRow => ({
  ...row,
  cells,
});
export const rowsOnScreenSignature = (rows: readonly DrawnRow[]): string =>
  rows
    .filter(isRowOnScreen)
    .map(({ key, rowNumber }) => `${key} ${rowNumber}`)
    .join();
export const offScreenRowsByKey = (rows: readonly DrawnRow[]): Map<string, DrawnRow> =>
  new Map(rows.filter((row) => !isRowOnScreen(row)).map((row): [string, DrawnRow] => [row.key, row]));
export const cellsSignatureOf = (row: DrawnRow | undefined): string | null => (row === undefined ? null : JSON.stringify(row.cells));
