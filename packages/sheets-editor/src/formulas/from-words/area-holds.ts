import type { NumberFormatKind, RowId, SheetId } from '@open-artifact/sheets-core';
import { cellValueOf, usersOfCell } from '../../model/cell-values.ts';
import { numberFormatOfCell } from '../../model/workbook.ts';
import type { CellId, SheetRead, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
/** A kind of value an area holds, as the formulas written from words tell them apart. */
export type HeldKind =
  | 'severalPeople'
  | 'trueOrFalse'
  | 'error'
  | 'number'
  | 'percent'
  | 'date'
  | 'time'
  | 'dateAndTime'
  | 'text'
  | 'numberAsText';
/** What the cells of an area hold, counted once for the words of a formula to be read against. */
export interface AreaHolds {
  filledCount: number;
  kinds: Set<HeldKind>;
  /** Each text held, lower-cased, to how it is first spelled. */
  spelled: Map<string, string>;
  /** Each text held, lower-cased with its spaces squeezed out, to the lower-cased text, or null when texts apart by spaces alone share it. */
  squeezed: Map<string, string | null>;
  isTooMany: boolean;
  isAnyRepeated: boolean;
  textCount: number;
  numberCount: number;
  sum: number;
  /** The number in each filled row, or null when that row holds something else. */
  byRow: Map<RowId, number | null>;
  /** The lowest and highest numbers held. */
  numbersLieIn: [number, number] | null;
  isEveryNumberWhole: boolean;
  isAnyFilledAndBlank: boolean;
}
export function holdsOfCells(workbook: WorkbookReads, cellIds: CellId[]): AreaHolds {
  let kinds = new Set<HeldKind>();
  let spelled = new Map<string, string>();
  let squeezed = new Map<string, string | null>();
  let distinct = new Set<string>();
  let byRow = new Map<RowId, number | null>();
  let [filledCount, textCount, numberCount, sum] = [0, 0, 0, 0];
  let [lowest, highest] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let [isEveryNumberWhole, isAnyFilledAndBlank] = [true, false];
  let isTooMany = cellIds.length > MOST_CELLS_LOOKED_AT;
  for (let cellId of isTooMany ? [] : cellIds) {
    let cell = workbook.cellOnShowIn(cellId);
    let value = cellValueOf(cell);
    if (value === null || (value.kind === 'text' && value.value.trim() === '')) {
      isAnyFilledAndBlank = true;
      continue;
    }
    if (value.kind === 'text' && !/[\p{L}\p{N}]/u.test(value.value)) isAnyFilledAndBlank = true;
    distinct.add(String(value.value).toLowerCase());
    filledCount += 1;
    byRow.set(cellId.rowId, value.kind === 'number' ? value.value : null);
    if (usersOfCell(cell).length > 1) kinds.add('severalPeople');
    if (value.kind === 'boolean') kinds.add('trueOrFalse');
    else if (value.kind === 'error') kinds.add('error');
    else if (value.kind === 'number') {
      kinds.add(HELD_KIND_OF_NUMBER_FORMAT[numberFormatOfCell(workbook, cellId).kind]);
      [numberCount, sum] = [numberCount + 1, sum + value.value];
      [lowest, highest] = [Math.min(lowest, value.value), Math.max(highest, value.value)];
      isEveryNumberWhole &&= Number.isInteger(value.value);
    } else {
      kinds.add('text');
      textCount += 1;
      if (NUMBER_LIKE_TEXT_PATTERN.test(value.value.trimStart())) kinds.add('numberAsText');
      let lowered = value.value.toLowerCase();
      let squeezedText = squeezeSpaces(lowered);
      squeezed.set(squeezedText, !squeezed.has(squeezedText) || squeezed.get(squeezedText) === lowered ? lowered : null);
      if (!spelled.has(lowered)) spelled.set(lowered, value.value);
    }
  }
  return {
    filledCount: isTooMany ? cellIds.length : filledCount,
    kinds,
    spelled,
    squeezed,
    isTooMany,
    isAnyRepeated: isTooMany || distinct.size < filledCount,
    textCount,
    numberCount,
    sum,
    byRow,
    numbersLieIn: numberCount === 0 ? null : [lowest, highest],
    isEveryNumberWhole,
    isAnyFilledAndBlank: isTooMany || isAnyFilledAndBlank,
  };
}
export function areAllNumbersIn(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean {
  if (area.rowCount * area.columnCount > MOST_CELLS_CHECKED_FOR_NUMBERS) return false;
  let sheet: Partial<SheetRead> = workbook.sheetAsItStands(sheetId) ?? {};
  let sheetCache = allNumbersCache.get(sheet);
  if (sheetCache === undefined) allNumbersCache.set(sheet, (sheetCache = new Map<string, boolean>()));
  let areaKey = [area.topRowIndex, area.leftColumnIndex, area.rowCount, area.columnCount].join();
  let areAllNumbers = sheetCache.get(areaKey);
  if (areAllNumbers === undefined) {
    let cellIds = workbook.cellsOnShowIn(sheetId, area);
    let isNumberCell = (cellId: CellId) => cellValueOf(workbook.cellOnShowIn(cellId))?.kind === 'number';
    sheetCache.set(areaKey, (areAllNumbers = cellIds.every(isNumberCell)));
  }
  return areAllNumbers;
}
export function holdsOfArea(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): AreaHolds {
  let sheet = workbook.sheetAsItStands(sheetId);
  if (sheet === null) return holdsOfCells(workbook, workbook.cellsOnShowIn(sheetId, area));
  let sheetCache = areaHoldsCache.get(sheet);
  if (sheetCache === undefined) areaHoldsCache.set(sheet, (sheetCache = new Map<string, AreaHolds>()));
  let holds = sheetCache.get(areaCacheKey(area));
  if (holds === undefined) sheetCache.set(areaCacheKey(area), (holds = holdsOfCells(workbook, workbook.cellsOnShowIn(sheetId, area))));
  return holds;
}
export function holdsOfEachColumn(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): AreaHolds[] {
  let columnAreas = Array.from(
    {
      length: area.columnCount,
    },
    (_, offset): CellArea => ({
      ...area,
      leftColumnIndex: area.leftColumnIndex + offset,
      columnCount: 1,
    }),
  );
  let sheet = workbook.sheetAsItStands(sheetId);
  let sheetCache = sheet === null ? undefined : areaHoldsCache.get(sheet);
  if (sheet === null || columnAreas.every((columnArea) => sheetCache?.has(areaCacheKey(columnArea)) === true))
    return columnAreas.map((columnArea) => holdsOfArea(workbook, sheetId, columnArea));
  let cellsByColumn = columnAreas.map((): CellId[] => []);
  for (let cellId of workbook.cellsOnShowIn(sheetId, area))
    cellsByColumn[(workbook.positionOfCell(cellId)?.columnIndex ?? -1) - area.leftColumnIndex]?.push(cellId);
  let holdsByColumn = cellsByColumn.map((cellIds) => holdsOfCells(workbook, cellIds));
  let cache = sheetCache ?? new Map<string, AreaHolds>();
  areaHoldsCache.set(sheet, cache);
  for (let [columnOffset, columnArea] of columnAreas.entries()) {
    let holds = holdsByColumn[columnOffset];
    if (holds !== undefined) cache.set(areaCacheKey(columnArea), holds);
  }
  return holdsByColumn;
}
export const MOST_CELLS_LOOKED_AT = 3000;
export const NUMBER_LIKE_TEXT_PATTERN = /^[-+(]?\p{Sc}?\s*\d/u;
export const HELD_KIND_OF_NUMBER_FORMAT: Record<NumberFormatKind, HeldKind> = {
  general: 'number',
  number: 'number',
  currency: 'number',
  scientific: 'number',
  fraction: 'number',
  text: 'number',
  percent: 'percent',
  date: 'date',
  time: 'time',
  duration: 'time',
  dateAndTime: 'dateAndTime',
};
export const squeezeSpaces = (text: string): string => text.replaceAll(/\s+/g, '');
export const MOST_CELLS_CHECKED_FOR_NUMBERS = 20000;
/** Whether each area holds numbers alone, by sheet (or by a fresh object, kept for nothing, when the sheet is not found). */
export const allNumbersCache = new WeakMap<Partial<SheetRead>, Map<string, boolean>>();
export const areaHoldsCache = new WeakMap<SheetRead, Map<string, AreaHolds>>();
export const areaCacheKey = (area: CellArea): string => [area.topRowIndex, area.leftColumnIndex, area.rowCount, area.columnCount].join();
