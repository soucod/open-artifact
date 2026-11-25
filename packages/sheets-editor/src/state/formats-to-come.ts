import type { DropdownOption, Edit, NumberFormatKind } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { EnterEdit } from '../model/edit-effects.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { PageState } from './initial-state.ts';
import type { PageEffect, PageTransition, QueueEditEffect } from './transitions.ts';
import type { placedTablesOfSheet as PlacedTablesOfSheet } from '../tables/finding.ts';
import { readsWithUnansweredEntries, markEditByPage } from '../editor/unanswered-entries.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { placedTablesOfSheet } from '../tables/finding.ts';
import { canOutlineTable } from '../tables/tables-in-view.ts';
import { isOptionText } from '../chips/dropdown-options.ts';
import { parseBooleanText, addTextPrefixQuote } from '../model/cell-text.ts';
import { selectionOfArea, isSameCell } from '../selection/model.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { parsePlainNumber } from '../format/number-signs.ts';
import { formatsToComeOf } from '../presence/follow-person.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { MAX_TEXT_ANSWERED_LATER } from '../editor/entries-answered-later.ts';
import { editsOfQueued } from '../engine/cause-of-error-cache.ts';
export function followedPartsOfFormat(format: WholeCellFormat): FollowedFormat {
  let { numberFormat, font, border, ...rest } = format;
  let pattern = {
    pattern: numberFormat.pattern,
  };
  return {
    ...rest,
    numberFormat: pattern,
    font: {
      ...font,
      strikethrough: false,
    },
  };
}
export function formatOfRowsAbove(reads: WorkbookReads, cellId: CellId, [above, twoAbove]: [CellId, CellId]): PartsFollowed {
  let [own, ofAbove, ofTwoAbove] = [cellId, above, twoAbove].map((id: CellId) => followedPartsOfFormat(reads.formatOf(id)));
  if (own === undefined || ofAbove === undefined || ofTwoAbove === undefined) return {};
  let isFollowed = (part: keyof FollowedFormat) =>
    isSamePartOfFormat(ofAbove, ofTwoAbove, part) &&
    isSamePartOfFormat(own, DEFAULT_FOLLOWED_FORMAT, part) &&
    !isSamePartOfFormat(ofAbove, own, part);
  return {
    ...(isFollowed('numberFormat') &&
      own.cellControl.kind === 'none' && {
        numberFormat: ofAbove.numberFormat,
      }),
    ...(isFollowed('alignment') && {
      alignment: ofAbove.alignment,
    }),
    ...(isFollowed('fillColor') && {
      fillColor: ofAbove.fillColor,
    }),
    ...(isFollowed('font') &&
      !reads.formatOf(cellId).font.strikethrough && {
        font: ofAbove.font,
      }),
    ...(isFollowed('cellControl') && {
      cellControl: ofAbove.cellControl,
    }),
  };
}
export function tableColumnsAboveEntry(state: PageState, reads: WorkbookReads, { rowIndex, columnIndex }: CellPosition): LinesFromTo | null {
  let { sheetId } = state;
  let readsWithEntries = readsWithUnansweredEntries(reads, state);
  let isRowFilledIn = (row: number, { first, last }: LinesFromTo) =>
    readsWithEntries.columnIndexesOnShowIn(sheetId, row).some((column: number) => {
      if (column < first || column > last) return false;
      let cell = readsWithEntries.cellIdAt(sheetId, row, column);
      let value = cell === null ? null : cellValueOf(readsWithEntries.cellOnShowIn(cell));
      return value?.kind !== 'text' || value.value !== '';
    });
  let table = placedTablesOfSheet(state, readsWithEntries, sheetId)
    .certain.filter(({ body, columns }: PlacedTable) => {
      if (body === null || columnIndex < columns.first || columnIndex > columns.last) return false;
      let rowsBetween = rowIndex - 1 - body.last;
      if (rowsBetween < 0 || rowsBetween > MOST_EMPTY_ROWS_UNDER_TABLE) return false;
      return Array.from(
        {
          length: rowsBetween,
        },
        (_: unknown, index: number) => body.last + 1 + index,
      ).every((row: number) => isRowFilledIn(row, columns));
    })
    .find((table: PlacedTable) => canOutlineTable(table, state, reads));
  if (table === undefined || table.body === null) return null;
  let { body, columns } = table;
  let rowOfEntry: CellArea = {
    topRowIndex: rowIndex,
    rowCount: 1,
    leftColumnIndex: columns.first,
    columnCount: columns.last - columns.first + 1,
  };
  if (isRowFilledIn(rowIndex, columns) || readsWithEntries.mergedAreasIn(sheetId, rowOfEntry).length > 0) return null;
  if (rowIndex - 1 === body.first) return null;
  return columns;
}
export function formatRunsOfRow({ first, last }: LinesFromTo, rowIndex: number, formatAt: (column: number) => PartsFollowed): FormatRun[] {
  let runs: FormatRun[] = [];
  for (let column = first; column <= last; column += 1) {
    let format = formatAt(column);
    let lastRun = runs.at(-1);
    if (
      lastRun !== undefined &&
      lastRun.area.leftColumnIndex + lastRun.area.columnCount === column &&
      JSON.stringify(lastRun.format) === JSON.stringify(format)
    )
      runs[runs.length - 1] = {
        ...lastRun,
        area: {
          ...lastRun.area,
          columnCount: lastRun.area.columnCount + 1,
        },
      };
    else
      runs.push({
        format,
        area: {
          topRowIndex: rowIndex,
          rowCount: 1,
          leftColumnIndex: column,
          columnCount: 1,
        },
      });
  }
  return runs;
}
export function formatsToComeOfEntry(state: PageState, reads: WorkbookReads, cellId: CellId, text: string): FormatsToComeOfEntry {
  let { sheetId } = state;
  let position = reads.positionOfCell(cellId);
  let columns = position === null ? null : tableColumnsAboveEntry(state, reads, position);
  if (position === null || columns === null)
    return {
      formats: [],
      entered: null,
      toCome: [],
    };
  let cellAbove = reads.cellIdAt(sheetId, position.rowIndex - 1, position.columnIndex);
  let dropdownAbove = cellAbove === null ? null : reads.dropdownOf(cellAbove);
  let optionChosen = dropdownAbove?.options.find(
    (option: DropdownOption) =>
      isOptionText(
        {
          ...dropdownAbove,
          options: [option],
        },
        text,
      ),
  );
  let fitsControlAbove = dropdownAbove === null ? parseBooleanText(text) !== null : optionChosen !== undefined;
  let followedAt = (column: number): PartsFollowed => {
    let cellAt = (up: number) => reads.cellIdAt(sheetId, position.rowIndex - up, column);
    let [own, above, twoAbove] = [cellAt(0), cellAt(1), cellAt(2)];
    if (own === null || above === null || twoAbove === null) return {};
    let { cellControl, ...rest } = formatOfRowsAbove(reads, own, [above, twoAbove]);
    return cellControl !== undefined && (column !== position.columnIndex || fitsControlAbove)
      ? {
          ...rest,
          cellControl,
        }
      : rest;
  };
  let formatEditsOf = (area: CellArea, format: PartsFollowed): Edit[] => {
    let selection = Object.keys(format).length === 0 ? null : selectionOfArea(state, reads, area);
    let cells = selection === null ? null : cellBlockOfSelection(state, reads, selection);
    return cells === null
      ? []
      : [
          {
            kind: 'formatCells',
            cells,
            format,
          },
        ];
  };
  let followedAtEntry = followedAt(position.columnIndex);
  let isOptionOfDropdown = followedAtEntry.cellControl?.kind === 'dropdown' && optionChosen !== undefined;
  let { numberFormat: numberFormatAbove, cellControl: controlAbove } = cellAbove === null ? DEFAULT_CELL_FORMAT : reads.formatOf(cellAbove);
  let isKeptAsText =
    !isOptionOfDropdown &&
    followedAtEntry.numberFormat !== undefined &&
    numberFormatAbove.kind === 'text' &&
    controlAbove.kind === 'none' &&
    parseBooleanText(text) === null;
  let takesNumberFormat =
    isOptionOfDropdown ||
    isKeptAsText ||
    (parsePlainNumber(text, reads.decimalSign) !== null && NUMBER_KINDS_OF_FORMAT.has(numberFormatAbove.kind) && controlAbove.kind === 'none');
  let { numberFormat, ...withoutNumberFormat } = followedAtEntry;
  let formatOfColumn = (column: number): PartsFollowed => {
    if (column === position.columnIndex) return takesNumberFormat ? followedAtEntry : withoutNumberFormat;
    let { cellControl, ...rest } = followedAt(column);
    let cell = reads.cellIdAt(sheetId, position.rowIndex, column);
    if (cellControl === undefined || cell === null) return rest;
    return reads.cellOnShowIn(cell) === null || (cellControl.kind === 'checkbox' && reads.cellOf(cell)?.input.kind === 'formula')
      ? {
          ...rest,
          cellControl,
        }
      : rest;
  };
  let formats = formatRunsOfRow(columns, position.rowIndex, formatOfColumn).flatMap(
    ({ area, format }: FormatRun) => formatEditsOf(area, format),
  );
  let toCome: FormatToCome[] = [];
  for (let column = columns.first; column <= columns.last; column += 1) {
    let cell = reads.cellIdAt(sheetId, position.rowIndex, column);
    let above = reads.cellIdAt(sheetId, position.rowIndex - 1, column);
    let format = formatOfColumn(column);
    if (Object.keys(format).length === 0 || cell === null || above === null) continue;
    let {
      numberFormat: numberFormatOfCellAbove,
      alignment,
      fillColor,
      font,
      cellControl,
    } = reads.formatOf(above);
    let look: LookToCome = {
      ...(format.numberFormat !== undefined && {
        numberFormat: numberFormatOfCellAbove,
      }),
      ...(format.alignment !== undefined && {
        alignment,
      }),
      ...(format.fillColor !== undefined && {
        fillColor,
      }),
      ...(format.font !== undefined && {
        font: {
          ...font,
          strikethrough: false,
        },
      }),
      ...(format.cellControl !== undefined && {
        cellControl,
      }),
    };
    let dropdownSource =
      formatsToComeOf(state).find((toComeAbove: FormatToCome) => isSameCell(toComeAbove.cellId, above))?.dropdownOf ?? above;
    let dropdownOf = format.cellControl?.kind === 'dropdown' ? dropdownSource : null;
    toCome.push({
      cellId: cell,
      look,
      dropdownOf,
      ...(column === position.columnIndex && {
        isOfEntry: true,
      }),
    });
  }
  let isTypedAsText = !isKeptAsText || text.startsWith(addTextPrefixQuote(''));
  let entered = isOptionOfDropdown ? textKeptAsText(optionChosen!.label) : isTypedAsText ? null : textKeptAsText(text);
  return {
    formats,
    entered,
    toCome,
  };
}
export function withFormatsOfRowsAbove(transition: PageTransition, state: PageState, reads: WorkbookReads): PageTransition {
  let [effect, otherEntry] = transition.effects.filter(
    (candidate: PageEffect) => candidate.kind === 'queueEdit' && candidate.edit.kind === 'enter',
  );
  if (otherEntry !== undefined || effect?.kind !== 'queueEdit' || effect.edit.kind !== 'enter') return transition;
  let { edit, ifQueued } = effect as QueueEditEffect & { edit: EnterEdit };
  if (ifQueued.endsEntryAtOnce !== true) return transition;
  if (edit.entry.kind !== 'text' || edit.entry.text.trim() === '') return transition;
  if (isFormulaText(edit.entry.text)) return transition;
  if (edit.entry.text.length > MAX_TEXT_ANSWERED_LATER) return transition;
  if (editsOfQueued(effect).length > 1) return transition;
  if (ifQueued.thenLine !== undefined) return transition;
  let cellId: CellId = {
    sheetId: edit.sheetId,
    rowId: edit.cell.r,
    columnId: edit.cell.c,
  };
  let dropdown = reads.dropdownOf(cellId);
  if (dropdown !== null && !isOptionText(dropdown, edit.entry.text)) return transition;
  let { formats, entered, toCome } = formatsToComeOfEntry(state, reads, cellId, edit.entry.text);
  if (formats.length === 0 || formats.length > MOST_FORMAT_EDITS_OF_ENTRY) return transition;
  let editEntered: EnterEdit =
    entered === null
      ? edit
      : {
          ...edit,
          entry: {
            kind: 'text',
            text: entered,
          },
        };
  let effectWithFormats: QueueEditEffect = {
    ...effect,
    edit: editEntered,
    editsThatGoAlong: formats.map(markEditByPage),
    ifQueued: {
      ...ifQueued,
      formatsToCome: toCome,
    },
  };
  return {
    ...transition,
    effects: transition.effects.map((candidate: PageEffect) => (candidate === effect ? effectWithFormats : candidate)),
  };
}
export const DEFAULT_FOLLOWED_FORMAT: FollowedFormat = followedPartsOfFormat(DEFAULT_CELL_FORMAT);
export const isSamePartOfFormat = (format: FollowedFormat, otherFormat: FollowedFormat, part: keyof FollowedFormat): boolean =>
  JSON.stringify(format[part]) === JSON.stringify(otherFormat[part]);
export const MOST_EMPTY_ROWS_UNDER_TABLE = 100;
export const textKeptAsText = (text: string): string =>
  /^[\p{L}\p{M} ]+$/u.test(text) && parseBooleanText(text) === null ? text : addTextPrefixQuote(text);
export const NUMBER_KINDS_OF_FORMAT = new Set<NumberFormatKind>(['number', 'currency', 'scientific', 'fraction']);
export const MOST_FORMAT_EDITS_OF_ENTRY = 10;
/** The parts of a cell's format the cells of a new row take from the rows above: all but its borders, and its number format by pattern. */
export interface FollowedFormat extends Omit<WholeCellFormat, 'numberFormat' | 'border'> {
  numberFormat: { pattern: string };
}
/** The parts of a cell's format taken from the rows above it. */
export type PartsFollowed = Partial<FollowedFormat>;
/** A run of cells of a row that take the same format from the rows above. */
export interface FormatRun {
  format: PartsFollowed;
  area: CellArea;
}
/** How a cell of a new row looks once the formats it takes from the rows above are answered. */
export type LookToCome = Partial<Omit<WholeCellFormat, 'border'>>;
/** A cell of a new row taking formats from the rows above, shown so before the edits are answered. */
export interface FormatToCome {
  cellId: CellId;
  look: LookToCome;
  /** The cell whose dropdown the cell takes, if it takes one. */
  dropdownOf: CellId | null;
  isOfEntry?: true;
}
/** The format edits an entry in a new row of a table brings along, the text it is entered as, and how its row looks till then. */
export interface FormatsToComeOfEntry {
  formats: Edit[];
  entered: string | null;
  toCome: FormatToCome[];
}
/** Lines from one index to another, both in. */
interface LinesFromTo {
  first: number;
  last: number;
}
/** A table found on the sheet, placed in its rows and columns. */
type PlacedTable = ReturnType<typeof PlacedTablesOfSheet>['certain'][number];
