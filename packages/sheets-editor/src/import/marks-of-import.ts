import type { Edit } from '@open-artifact/sheets-core';
import type { MarksOfImport, MarksOfImportToCome, PageState, StateWhenImportMarked } from '../state/initial-state.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { DrawnCell, DrawnRow } from '../grid/grid-drawing.tsx';
export function importMarksToCome(edit: Edit, reads: WorkbookReads): MarksOfImportToCome | null {
  if (edit.kind !== 'importTableIntoSheet') return null;
  let { sheetId, columns, how } = edit.table;
  let changes = reads.whatATableChanges(edit.table);
  if (changes === null || changes.kind === 'refused') return null;
  let isReplacingRows = how.kind === 'replaceRows';
  return {
    sheetId,
    updated: new Set(
      isReplacingRows
        ? []
        : changes.rows.flatMap(
            (row) =>
              row.kind !== 'changes'
                ? []
                : row.columns.flatMap((columnIndex) => {
                    let columnInto = columns[columnIndex];
                    return columnInto === null || columnInto === undefined ? [] : [`${row.row} ${columnInto.column}`];
                  }),
          ),
    ),
    columns: new Set(columns.flatMap((columnInto) => (columnInto === null ? [] : [columnInto.column]))),
    rowsBefore: new Set(isReplacingRows ? [] : reads.rowsAsTheyStand(sheetId).keys()),
  };
}
export function updateImportMarks(state: PageState, event: PageEvent, reads: WorkbookReads): PageState {
  let { marksOfImport, marksOfImportToCome } = state;
  if (event.kind !== 'editAnswered' || event.edit.kind !== 'importTableIntoSheet' || marksOfImportToCome === null)
    return marksOfImport !== null && (event.kind === 'marksOfImportOver' || !areImportMarksStillShown(state, marksOfImport))
      ? {
          ...state,
          marksOfImport: null,
        }
      : state;
  let areaChanged = event.outcome.kind === 'editQueued' ? event.outcome.placeChanged?.area : null;
  if (areaChanged === null || areaChanged === undefined)
    return {
      ...state,
      marksOfImport: null,
      marksOfImportToCome: null,
    };
  let { sheetId, updated, columns, rowsBefore } = marksOfImportToCome;
  return {
    ...state,
    marksOfImportToCome: null,
    marksOfImport: {
      sheetId,
      updated,
      columns,
      addedRows: new Set([...reads.rowsAsTheyStand(sheetId).keys()].filter((rowId) => !rowsBefore.has(rowId))),
      rowNumbersWritten: {
        first: areaChanged.topRowIndex + 1,
        last: areaChanged.topRowIndex + areaChanged.rowCount,
      },
      stateWhenSet: {
        changesAskedFor: state.changesAskedFor,
        sheetId: state.sheetId,
        scrollTop: state.scrollTop,
        scrollLeft: state.scrollLeft,
        gridWidth: state.gridWidth,
        gridHeight: state.gridHeight,
        zoom: state.zoom,
      },
    },
  };
}
export function markImportedCells(
  rows: DrawnRow[],
  { marksOfImport, sheetId }: Pick<PageState, 'marksOfImport' | 'sheetId'>,
): DrawnRow[] {
  if (marksOfImport === null || marksOfImport.sheetId !== sheetId) return rows;
  let markOfCell = (row: DrawnRow, columnId: string): DrawnCell['markOfImport'] =>
    marksOfImport.addedRows.has(row.key) &&
    row.rowNumber >= marksOfImport.rowNumbersWritten.first &&
    row.rowNumber <= marksOfImport.rowNumbersWritten.last
      ? marksOfImport.columns.has(columnId)
        ? 'added'
        : null
      : marksOfImport.updated.has(`${row.key} ${columnId}`)
        ? 'updated'
        : null;
  let markedRows = rows.filter((row) => row.cells.some((cell) => markOfCell(row, cell.key) !== null));
  let staggerMs = Math.min(120, 1200 / markedRows.length);
  return rows.map((row) => {
    let markedIndex = markedRows.indexOf(row);
    return markedIndex < 0
      ? row
      : {
          ...row,
          cells: row.cells.map((cell) => {
            let mark = markOfCell(row, cell.key);
            return mark === null
              ? cell
              : {
                  ...cell,
                  markOfImport: mark,
                  markOfImportDelayMs: Math.round(markedIndex * staggerMs),
                };
          }),
        };
  });
}
export const IMPORT_MARKS_VIEW_KEYS: (keyof StateWhenImportMarked)[] = [
  'changesAskedFor',
  'sheetId',
  'scrollTop',
  'scrollLeft',
  'gridWidth',
  'gridHeight',
  'zoom',
];
export const IMPORT_MARKS_SHOWN_MS = 2400;
export const areImportMarksStillShown = (state: PageState, { stateWhenSet }: MarksOfImport) =>
  IMPORT_MARKS_VIEW_KEYS.every((key) => state[key] === stateWhenSet[key]) &&
  state.mode.kind !== 'editing' &&
  state.importOfAFile === null;
