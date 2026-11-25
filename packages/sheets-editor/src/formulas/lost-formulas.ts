import { readsAsStored, isFormulaCell } from '../model/workbook.ts';
import { areaToA1AsStored } from './from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { cellKeyOf } from './error-tells.ts';
import type { ActThatLosesFormulas, LostFormula, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ActThatMayLoseFormulas, LossOfFormulasToTell, PageEvent } from '../state/event-reducer.ts';
import type { SortedArea } from '../tables/sort-changed-results.ts';
import type { CellArea } from '../selection/model.ts';
import type { CellContents, ColumnId, Edit, EditKind, SheetId } from '@open-artifact/sheets-core';
/** A cell whose formula reads #REF! after a sort, with its row's offset in the sorted area. */
interface FormulaBrokenBySort {
  cellId: CellId;
  row: number;
  columnIndex: number;
}
/** The rows of a sorted area that hold the same inputs, and whether their order is sure to be kept. */
interface RowsWithSameInputs {
  rows: number[];
  isOrderKept: boolean;
}
export function actThatMayLoseFormulas(edit: Edit, workbook: WorkbookReads): Omit<LossOfFormulasToTell, 'reads'> | null {
  let word = WORD_OF_LINE_ACT[edit.kind];
  if (word !== undefined && 'sheetId' in edit)
    return {
      act: {
        kind: 'cellsKeepWhatTheyHold',
        sheetId: edit.sheetId,
      },
      word,
    };
  if (edit.kind !== 'sortRows' && edit.kind !== 'sortCells') return null;
  let sheetId = edit.kind === 'sortRows' ? edit.sheetId : edit.cells.sheetId;
  let sheet = workbook.listSheets().find((summary) => summary.sheetId === sheetId);
  if (sheet === undefined) return null;
  let [oneRow = null, otherRow = null] = (
    edit.kind === 'sortRows' ? [edit.oneRow, edit.otherRow] : [edit.cells.oneCorner.r, edit.cells.otherCorner.r]
  ).map((rowId) => workbook.rowIndexOf(sheetId, rowId));
  let columnIndexOf = (columnId: ColumnId) => workbook.columnIndexOf(sheetId, columnId);
  let [oneColumn = null, otherColumn = null] =
    edit.kind === 'sortRows' ? [0, sheet.columnCount - 1] : [edit.cells.oneCorner.c, edit.cells.otherCorner.c].map(columnIndexOf);
  let keyColumns = [edit.byColumn, ...(edit.thenBy ?? []).map(({ byColumn }) => byColumn)].map(columnIndexOf);
  let keyColumnIndexes = keyColumns.filter((columnIndex) => columnIndex !== null);
  if (oneRow === null || otherRow === null) return null;
  if (oneColumn === null || otherColumn === null) return null;
  if (keyColumnIndexes.length < keyColumns.length) return null;
  let topRowIndex = Math.max(Math.min(oneRow, otherRow), sheet.frozenRowCount);
  let area = {
    topRowIndex,
    leftColumnIndex: Math.min(oneColumn, otherColumn),
    rowCount: Math.max(oneRow, otherRow) - topRowIndex + 1,
    columnCount: Math.abs(oneColumn - otherColumn) + 1,
  };
  return {
    act: {
      kind: 'sorted',
      sheetId,
      area,
      keyColumnIndexes,
    },
    word: 'sort',
  };
}
export function rowInputsKey(
  workbook: WorkbookReads,
  sheetId: SheetId,
  { leftColumnIndex, columnCount }: CellArea,
  rowIndex: number,
): string {
  let inputs = [];
  for (let index = 0; index < columnCount; index += 1) {
    let cellId = workbook.cellIdAt(sheetId, rowIndex, leftColumnIndex + index);
    let input = cellId === null ? undefined : workbook.cellOf(cellId)?.input;
    inputs.push(input === undefined ? null : input.kind === 'formula' ? 'formula' : input);
  }
  return JSON.stringify(inputs);
}
export function sortSourceRowsById(
  before: WorkbookReads,
  after: WorkbookReads,
  { sheetId, area }: SortedArea,
): (number | null)[] | null {
  let sources = Array.from(
    {
      length: area.rowCount,
    },
    (_, offset) => {
      let cellId = after.cellIdAt(sheetId, area.topRowIndex + offset, area.leftColumnIndex);
      let rowIndexBefore = cellId === null ? null : before.rowIndexOf(sheetId, cellId.rowId);
      return rowIndexBefore === null ? null : rowIndexBefore - area.topRowIndex;
    },
  );
  return sources.every((source, offset) => source === offset) ? null : sources;
}
export function sortSourceRows(before: WorkbookReads, after: WorkbookReads, sorted: SortedArea): (number | null)[] {
  let sourcesById = sortSourceRowsById(before, after, sorted);
  if (sourcesById !== null) return sourcesById;
  let { sheetId, keyColumnIndexes } = sorted;
  let areaOnShow = before.areaOnShowIn(sheetId, sorted.area) ?? sorted.area;
  let { leftColumnIndex, columnCount } = areaOnShow;
  let area = {
    ...sorted.area,
    leftColumnIndex,
    columnCount,
  };
  let rowsByKey = new Map<string, RowsWithSameInputs>();
  for (let offset = 0; offset < area.rowCount; offset += 1) {
    let rowIndex = area.topRowIndex + offset;
    let key = rowInputsKey(before, sheetId, area, rowIndex);
    let isKeyPlain = keyColumnIndexes.every((columnIndex) => {
      let cellId = before.cellIdAt(sheetId, rowIndex, columnIndex);
      return cellId !== null && !isFormulaCell(before, cellId);
    });
    let entry: RowsWithSameInputs = rowsByKey.get(key) ?? {
      rows: [],
      isOrderKept: true,
    };
    entry.rows.push(offset);
    entry.isOrderKept &&= isKeyPlain;
    rowsByKey.set(key, entry);
  }
  let takenByKey = new Map<string, number>();
  return Array.from(
    {
      length: area.rowCount,
    },
    (_, offset): number | null => {
      let key = rowInputsKey(after, sheetId, area, area.topRowIndex + offset);
      let entry = rowsByKey.get(key);
      if (entry === undefined || (entry.rows.length > 1 && !entry.isOrderKept)) return null;
      let taken = takenByKey.get(key) ?? 0;
      takenByKey.set(key, taken + 1);
      return entry.rows[taken] ?? null;
    },
  );
}
export function formulasLostToSort(before: WorkbookReads, after: WorkbookReads, sorted: SortedArea): Map<CellId, LostFormula> {
  let { sheetId, area } = sorted;
  let broken: FormulaBrokenBySort[] = [];
  let rowsBefore = before.cellsHeldByRow(sheetId);
  for (let [rowId, cells] of after.cellsHeldByRow(sheetId)) {
    if (rowsBefore.get(rowId) === cells) continue;
    for (let [columnId, cell] of cells) {
      if (!isFormulaWithRefError(cell)) continue;
      let cellId = {
        sheetId,
        rowId,
        columnId,
      };
      let position = after.positionOfCell(cellId);
      if (position === null) continue;
      let [rowOffset, columnOffset] = [position.rowIndex - area.topRowIndex, position.columnIndex - area.leftColumnIndex];
      if (rowOffset >= 0 && rowOffset < area.rowCount && columnOffset >= 0 && columnOffset < area.columnCount)
        broken.push({
          cellId,
          row: rowOffset,
          columnIndex: position.columnIndex,
        });
    }
  }
  let lost = new Map<CellId, LostFormula>();
  if (broken.length === 0) return lost;
  let sources = sortSourceRows(before, after, sorted);
  for (let { cellId, row: rowOffset, columnIndex } of broken) {
    let sourceRowOffset = sources[rowOffset] ?? null;
    if (sourceRowOffset === null) continue;
    let sourceRowIndex = area.topRowIndex + sourceRowOffset;
    let sourceCellId = before.cellIdAt(sheetId, sourceRowIndex, columnIndex);
    let sourceCell = sourceCellId === null ? null : before.cellOf(sourceCellId);
    let formulaTextNow = after.cellOf(cellId)?.formulaText ?? '';
    if (
      sourceCell?.formulaText !== undefined &&
      !isFormulaWithRefError(sourceCell) &&
      isSameFormulaShape(sourceCell.formulaText, formulaTextNow)
    )
      lost.set(cellId, {
        text: sourceCell.formulaText,
        input: sourceCell.input,
        cell: addressOfCellAt(sourceRowIndex, columnIndex),
        cameTo: sourceCell.value ?? null,
      });
  }
  return lost;
}
export function formulasLostToLineEdit(before: WorkbookReads, after: WorkbookReads, sheetId: SheetId): Map<CellId, LostFormula> {
  let lost = new Map<CellId, LostFormula>();
  let rowsBefore = before.cellsHeldByRow(sheetId);
  for (let [rowId, cells] of after.cellsHeldByRow(sheetId)) {
    if (rowsBefore.get(rowId) === cells) continue;
    for (let [columnId, cell] of cells) {
      if (!isFormulaWithRefError(cell)) continue;
      let cellId = {
        sheetId,
        rowId,
        columnId,
      };
      let cellBefore = before.cellOf(cellId);
      let positionBefore = before.positionOfCell(cellId);
      if (cellBefore?.formulaText !== undefined && positionBefore !== null && !isFormulaWithRefError(cellBefore))
        lost.set(cellId, {
          text: cellBefore.formulaText,
          input: cellBefore.input,
          cell: addressOfCellAt(positionBefore.rowIndex, positionBefore.columnIndex),
          cameTo: cellBefore.value ?? null,
        });
    }
  }
  return lost;
}
export function noteFormulasLostToLastAct(state: PageState, event: PageEvent, workbook: WorkbookReads): PageState {
  if (event.kind !== 'editAnswered' || event.outcome.kind !== 'editQueued') return state;
  let { before } = event;
  let lost =
    before === undefined ? new Map<CellId, LostFormula>() : formulasLostToAct(readsAsStored(before.reads), readsAsStored(workbook), before.act);
  if (before === undefined || lost.size === 0)
    return state.formulasLostToLastAct === null
      ? state
      : {
          ...state,
          formulasLostToLastAct: null,
        };
  let { act, word } = before;
  return {
    ...state,
    formulasLostToLastAct: {
      act: word,
      cells:
        act.kind === 'sorted' && event.edit.kind === 'sortCells' ? areaToA1AsStored(act.area, ownRowOrderOfSheet(workbook, state.sheetId)) : null,
      ...(event.edit.kind === 'deleteColumns' && {
        areColumnsDeleted: true,
      }),
      byCell: new Map<string, LostFormula>([...lost].map(([cellId, formula]) => [cellKeyOf(cellId), formula])),
      atChangeCount: state.workbookChangeCount,
    },
  };
}
export const WORD_OF_LINE_ACT: Partial<Record<EditKind, Exclude<ActThatLosesFormulas, 'sort'>>> = {
  deleteRows: 'delete',
  deleteColumns: 'delete',
  moveRows: 'move',
  moveColumns: 'move',
};
export const LOST_REF_ERROR_TEXT = '#REF!';
export const isFormulaWithRefError = (cell: CellContents): boolean =>
  cell?.input.kind === 'formula' && cell.formulaText?.includes(LOST_REF_ERROR_TEXT) === true;
export const REFERENCE_OR_REF_ERROR_PATTERN = /\$?[A-Z]+\$?\d+(?::\$?[A-Z]+\$?\d+)?|#REF!/g;
export const isSameFormulaShape = (formula: string, otherFormula: string): boolean =>
  formula.replace(REFERENCE_OR_REF_ERROR_PATTERN, '@') === otherFormula.replace(REFERENCE_OR_REF_ERROR_PATTERN, '@');
export const addressOfCellAt = (rowIndex: number, columnIndex: number): string =>
  areaToA1AsStored(
    {
      topRowIndex: rowIndex,
      leftColumnIndex: columnIndex,
      rowCount: 1,
      columnCount: 1,
    },
    null,
  );
export const formulasLostToAct = (before: WorkbookReads, after: WorkbookReads, act: ActThatMayLoseFormulas): Map<CellId, LostFormula> =>
  act.kind === 'sorted' && sortSourceRowsById(before, after, act) === null
    ? formulasLostToSort(before, after, act)
    : formulasLostToLineEdit(before, after, act.sheetId);
