import { mergedAreaOrCellOf } from '../selection/model.ts';
import { charsThatFitWidth } from '../grid/cell-metrics.ts';
import { shownCellText } from './shown-text.ts';
import { isGeneralPattern } from '../model/cell-format.ts';
import { withDecimalPlaces, decimalPlacesOfPattern, MAX_DECIMAL_PLACES, sampleValueOfFormatKind } from './number-format-choices.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { NUMBER_FORMAT_CHOICE_PATTERNS } from './number-format-choices-values.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { NumberFormatKind, SharedCellFormat, SheetId } from '@open-artifact/sheets-core';
/** The selection whose decimal places are stepped: its ranges on a sheet, its active cell, and the format its cells share. */
export interface SelectionForDecimalPlaces {
  sheetId: SheetId;
  ranges: CellArea[];
  activeCell: CellId;
  shared: SharedCellFormat | null;
}
/** A way to step the decimal places of the selection. */
export type DecimalPlaceChange = 'fewer' | 'more';
/** Why the decimal places of the selection cannot be stepped either way. */
export type WhyNoDecimalPlaceChanges = 'noNumbers' | 'formatHasNone' | 'formatsDiffer' | 'dropdownOrCheckbox';
/** The pattern a step of decimal places gives, and how many places it has. */
export interface DecimalPlacesStep {
  count: number;
  pattern: string;
}
/** The steps of decimal places the selection takes, or why it takes neither. */
export interface DecimalPlaceChanges {
  more: DecimalPlacesStep | null;
  fewer: DecimalPlacesStep | null;
  whyNeither: WhyNoDecimalPlaceChanges | null;
}
/** The pattern whose decimal places the selection steps, or why there is none. */
export type DecimalPatternOfSelection = { why: 'noNumbers' | 'formatHasNone' | 'formatsDiffer' } | { pattern: string };
export function numberFormatsBroughtIn(reads: WorkbookReads, { sheetId, ranges }: Pick<SelectionForDecimalPlaces, 'sheetId' | 'ranges'>): string[] {
  let patterns = new Set<string>();
  for (let range of ranges)
    for (let cellId of reads.cellsOnShowIn(sheetId, range)) {
      let pattern = reads.cellOnShowIn(cellId)?.numberFormatBrought?.pattern;
      if (pattern !== undefined && isNumberShownIn(reads, cellId)) patterns.add(pattern);
    }
  return [...patterns];
}
export function firstNumberCellOf(reads: WorkbookReads, cellIds: CellId[]): CellId | null {
  let [first, firstRowIndex, firstColumnIndex]: [CellId | null, number, number] = [null, 0, 0];
  for (let cellId of cellIds) {
    let position = isNumberShownIn(reads, cellId) ? reads.positionOfCell(cellId) : null;
    if (position === null) continue;
    if (first === null || position.rowIndex < firstRowIndex || (position.rowIndex === firstRowIndex && position.columnIndex < firstColumnIndex))
      [first, firstRowIndex, firstColumnIndex] = [cellId, position.rowIndex, position.columnIndex];
  }
  return first;
}
export function firstNumberCellInArea(reads: WorkbookReads, sheetId: SheetId, area: CellArea): CellId | null {
  for (let rowLimit = 32; ; rowLimit *= 8) {
    let topArea = {
      ...area,
      rowCount: Math.min(rowLimit, area.rowCount),
    };
    let found = firstNumberCellOf(reads, reads.cellsOnShowIn(sheetId, topArea));
    if (found !== null || rowLimit >= area.rowCount) return found;
  }
}
export function firstNumberCellInRanges(reads: WorkbookReads, { sheetId, ranges }: Pick<SelectionForDecimalPlaces, 'sheetId' | 'ranges'>): CellId | null {
  for (let index = ranges.length - 1; index >= 0; index -= 1) {
    let range = ranges[index];
    let found = range === undefined ? null : firstNumberCellInArea(reads, sheetId, range);
    if (found !== null) return found;
  }
  return null;
}
export function decimalPlacesShownInWidth(reads: WorkbookReads, sheetId: SheetId, cellId: CellId): number | null {
  let area = mergedAreaOrCellOf(reads, cellId);
  let columnEdges = reads.listSheets().find((sheet) => sheet.sheetId === sheetId)?.columnEdges;
  if (area === null || columnEdges === undefined) return null;
  let rightColumnIndex = area.leftColumnIndex + area.columnCount;
  let width = columnEdges.startOf(rightColumnIndex) - columnEdges.startOf(area.leftColumnIndex);
  let charsThatFit = charsThatFitWidth(width, reads.formatOf(cellId).font);
  let decimalsShownWith = (maxChars: number) =>
    /^-?\d+(?:[.,](?<places>\d+))?$/.exec(shownCellText(reads.cellOnShowIn(cellId), maxChars, reads.decimalSign).text);
  let match = decimalsShownWith(1 / 0) === null ? null : decimalsShownWith(charsThatFit);
  return match === null ? null : (match.groups?.places?.length ?? 0);
}
export function decimalPatternOfSelection(reads: WorkbookReads, selection: SelectionForDecimalPlaces): DecimalPatternOfSelection {
  let { sheetId, ranges, activeCell, shared } = selection;
  let isFormatShared = shared !== null && shared.numberFormat !== null && !isGeneralPattern(shared.numberFormat.pattern);
  let patterns = [
    ...new Set([
      ...ranges.flatMap((range) => reads.numberFormatPatternsIn(sheetId, range)),
      ...(isFormatShared ? [] : numberFormatsBroughtIn(reads, selection)),
    ]),
  ];
  if (patterns.length === 0) {
    let numberCell = isNumberShownIn(reads, activeCell) ? activeCell : firstNumberCellInRanges(reads, selection);
    if (numberCell === null)
      return {
        why: 'noNumbers',
      };
    let shownPlaces = decimalPlacesShownInWidth(reads, sheetId, numberCell);
    return shownPlaces === null
      ? {
          why: 'formatHasNone',
        }
      : {
          pattern: withDecimalPlaces(INTEGER_PATTERN, shownPlaces),
        };
  }
  let [basePattern, ...otherBasePatterns] = new Set(
    patterns.map((pattern) => withDecimalPlaces(pattern, 0)),
  );
  if (otherBasePatterns.length > 0)
    return {
      why: 'formatsDiffer',
    };
  if (
    !WHOLE_NUMBER_PATTERNS.has(basePattern) &&
    !isFormatShared &&
    ranges.some(
      (range) => reads.cellsOnShowIn(sheetId, range).some((cellId) => isGeneralNumberCell(reads, cellId)),
    )
  )
    return {
      why: 'formatsDiffer',
    };
  let mostPlacesPattern = patterns.reduce(
    (best, pattern) => ((decimalPlacesOfPattern(pattern) ?? 0) > (decimalPlacesOfPattern(best) ?? 0) ? pattern : best),
  );
  let isGeneral = isGeneralNumberCell(reads, activeCell);
  let patternPlaces = isNumberShownIn(reads, activeCell) ? decimalPlacesOfPattern(numberFormatOfCell(reads, activeCell).pattern) : null;
  let places = isGeneral ? decimalPlacesShownInWidth(reads, sheetId, activeCell) : patternPlaces;
  if (isGeneral && places === null)
    return {
      why: 'formatHasNone',
    };
  return {
    pattern: places === null ? mostPlacesPattern : withDecimalPlaces(mostPlacesPattern, places),
  };
}
export function decimalPlaceChanges(reads: WorkbookReads, selection: SelectionForDecimalPlaces): DecimalPlaceChanges {
  if (selection.shared === null) return noDecimalPlaceChanges(null);
  if (selection.shared.cellControl?.kind !== 'none') return noDecimalPlaceChanges('dropdownOrCheckbox');
  let found = decimalPatternOfSelection(reads, selection);
  if ('why' in found) return noDecimalPlaceChanges(found.why);
  let pattern = found.pattern;
  let places = decimalPlacesOfPattern(pattern);
  if (places === null) {
    let kindsRead: NumberFormatKind[] = [];
    reads.patternRead(pattern, (kind) => kindsRead.push(kind));
    return noDecimalPlaceChanges(NOT_DECIMAL_PATTERN_KINDS.has(kindsRead[0]) ? 'noNumbers' : 'formatHasNone');
  }
  let stepTo = (count: number): DecimalPlacesStep | null => {
    if (count < 0 || (count > MAX_DECIMAL_PLACES && count > places)) return null;
    let steppedPattern = withDecimalPlaces(pattern, count);
    let patternRead = reads.patternRead(steppedPattern, sampleValueOfFormatKind);
    return patternRead?.kind === 'numberFormat' && patternRead.shown.kind === 'text'
      ? {
          count,
          pattern: steppedPattern,
        }
      : null;
  };
  return {
    more: stepTo(places + 1),
    fewer: stepTo(places - 1),
    whyNeither: null,
  };
}
export const DECIMAL_PLACE_CHANGES: DecimalPlaceChange[] = ['fewer', 'more'];
export const noDecimalPlaceChanges = (why: WhyNoDecimalPlaceChanges | null): DecimalPlaceChanges => ({
  more: null,
  fewer: null,
  whyNeither: why,
});
export const NO_NUMBERS_DECIMAL_CHANGES = noDecimalPlaceChanges('noNumbers');
export const isNumberShownIn = (reads: WorkbookReads, cellId: CellId): boolean => cellValueOf(reads.cellOnShowIn(cellId))?.kind === 'number';
export const isGeneralNumberCell = (reads: WorkbookReads, cellId: CellId): boolean =>
  isNumberShownIn(reads, cellId) && isGeneralPattern(numberFormatOfCell(reads, cellId).pattern);
export const INTEGER_PATTERN = '0';
export const WHOLE_NUMBER_PATTERNS: ReadonlySet<string> = new Set([
  INTEGER_PATTERN,
  withDecimalPlaces(NUMBER_FORMAT_CHOICE_PATTERNS.number.pattern, 0),
]);
export const NOT_DECIMAL_PATTERN_KINDS: ReadonlySet<NumberFormatKind> = new Set<NumberFormatKind>(['date', 'time', 'dateAndTime', 'duration', 'text']);
