import { listLinesOfCell, cellValueOf, usersOfCell, richTextBoldItalic, levelInList, cellPlainText } from '../model/cell-values.ts';
import { cellTextLayout, wrappingOfWrapText } from './text-overflow.ts';
import { readCellLink } from '../links/cell-links.ts';
import { shownCellText } from '../format/shown-text.ts';
import { cellTextLinks } from '../links/text-links.ts';
import { hasRoomForText, textRoomInWidth, lineCountWithListGaps } from './cell-metrics.ts';
import { isInSpan } from './geometry.ts';
import { rowHeightForLinesAtDensity } from './cell-metrics-values.ts';
import { personChipLinesNeeded } from '../chips/person-chip-lines.ts';
import { rowHeightForPersonChipLines } from './chip-metrics.ts';
import type { RowId, SheetId } from '@open-artifact/sheets-core';
import type { WholeCellFormat, IndexRunsOfEntry } from '../model/cell-format.ts';
import type { CellId, RowAsItStands, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer, TextMeasurer } from '../state/controller.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { TallRow } from './cell-metrics.ts';
import type { GridLayout } from './layout.ts';
import type { LinkPart } from './grid-drawing.tsx';
/** A part of a cell's text, bold or italic or neither, to measure as it wraps. */
export interface WrappedTextPart {
  text: string;
  bold: boolean;
  italic: boolean;
}
/** The text of a cell that wraps, in the font it is drawn in, with its bold or italic parts and the levels of its list lines. */
export interface WrappedText {
  text: string;
  font: WholeCellFormat['font'];
  parts?: WrappedTextPart[];
  levelsInLists?: (number | null)[];
  areLinesCut?: true;
}
/** A cell's wrapped text, with the width it wraps in. */
export interface WrappedTextToMeasure extends WrappedText {
  widthInPixels: number;
}
/** The rows grown for wrapped text last measured, by the row as it stood, for one sheet. */
export type RowGrowthCache = WeakMap<RowAsItStands, TallRow>;
/** Of a row, the wrapped texts to measure and the height its people's chips need. */
export interface WrappedTextsAndPeopleOfRow {
  texts: WrappedTextToMeasure[];
  heightForPeople: number;
}
/** A row whose wrapped texts are yet to be measured. */
export interface RowToMeasure extends WrappedTextsAndPeopleOfRow {
  row: RowAsItStands;
  rowIndex: number;
}
export function wrappedTextOfCell(cellId: CellId, isMerged: boolean, reads: WorkbookReads): WrappedText | null {
  let cell = reads.cellOf(cellId);
  let shownCell = cell ?? reads.spilledCellOf(cellId);
  let format = reads.formatOf(cellId);
  let listLines = listLinesOfCell(cell);
  if (
    cellTextLayout(cellValueOf(shownCell), {
      isMerged,
      isTypedIn: false,
      isOfDropdown: format.cellControl.kind === 'dropdown',
      hasFilterButton: false,
      isPerson: usersOfCell(cell).length > 0,
      linkDrawnAs: readCellLink(cell, format)?.drawnAs ?? null,
      isFormulaShown: false,
      wrappingByFormat: wrappingOfWrapText(format.alignment.wrap),
      holdsList: listLines.length > 0,
      hasRoomToWrap: true,
    }) !== 'wrap'
  )
    return null;
  let { text } = shownCellText(shownCell, 0, 'point');
  let { bold, italic } = richTextBoldItalic(cell);
  let parts =
    bold || italic
      ? cellTextLinks(cell, format, text, null).parts.map(
          ({ text: partText, marks }: LinkPart): WrappedTextPart => ({
            text: partText,
            bold: marks.includes('bold'),
            italic: marks.includes('italic'),
          }),
        )
      : [];
  return {
    text,
    font: format.font,
    ...(parts.length > 0 && {
      parts,
    }),
    ...(listLines.length > 0 && {
      levelsInLists: listLines.map(({ list }): number | null => levelInList(list)),
    }),
    ...(format.alignment.wrap !== true && {
      areLinesCut: true,
    }),
  };
}
export function wrappedTextToMeasure(
  cellId: CellId,
  { columnEdges }: Pick<GridLayout, 'columnEdges'>,
  reads: WorkbookReads,
): WrappedTextToMeasure | null {
  let position = reads.positionOfCell(cellId);
  if (position === null) return null;
  let isMerged = reads.mergedAreaAt(cellId.sheetId, position) !== null;
  let wrappedText = wrappedTextOfCell(cellId, isMerged, reads);
  let columnWidth = columnEdges.sizeOf(position.columnIndex);
  if (wrappedText === null || !hasRoomForText(columnWidth, wrappedText.font.size)) return null;
  return {
    ...wrappedText,
    widthInPixels: textRoomInWidth(columnWidth),
  };
}
export function hasCellSeveralLines(cellId: CellId, layout: Pick<GridLayout, 'columnEdges'>, reads: ReadsWithTextMeasurer): boolean {
  if (cellPlainText(reads.cellOf(cellId))?.includes('\n') === true) return true;
  let measured = wrappedTextToMeasure(cellId, layout, reads);
  let [lineCount = 1] = measured === null ? [] : reads.lineCountsOfWrappedTexts([measured]);
  return lineCount > 1;
}
export function areCellLinesCut(cellId: CellId, layout: Pick<GridLayout, 'columnEdges'>, reads: ReadsWithTextMeasurer): boolean {
  let measured = wrappedTextToMeasure(cellId, layout, reads);
  if (measured?.areLinesCut !== true) return false;
  let [lineCount = 1] = reads.lineCountsOfWrappedTexts([measured]);
  return lineCount > (measured.levelsInLists?.length ?? 1);
}
export function heightForPeopleInCell(cellId: CellId, cellWidth: number, reads: ReadsWithTextMeasurer, density: CellDensity): number {
  let users = usersOfCell(reads.cellOf(cellId));
  if (users.length < 2) return 0;
  let { font, alignment } = reads.formatOf(cellId);
  if (wrappingOfWrapText(alignment.wrap) !== 'wrap') return 0;
  let lineCount = personChipLinesNeeded({
    cellWidth,
    nameWidths: users.map(({ label }) => reads.widthOfCharacters(label, font)),
    fontSizeInPoints: font.size,
    opensList: true,
  });
  return lineCount === 1 ? 0 : rowHeightForPersonChipLines(lineCount, font.size, density);
}
export function wrappedTextsAndPeopleInRow(
  rowId: RowId,
  rowIndex: number,
  wrapAreas: readonly IndexRunsOfEntry[],
  sheet: SheetSummary,
  reads: ReadsWithTextMeasurer,
  density: CellDensity,
): WrappedTextsAndPeopleOfRow {
  let listTexts = [...(reads.cellsWithListsIn(sheet.sheetId).get(rowId)?.keys() ?? [])]
    .flatMap(
      (columnId) =>
        wrappedTextToMeasure(
          {
            sheetId: sheet.sheetId,
            rowId,
            columnId,
          },
          sheet,
          reads,
        ) ?? [],
    )
    .filter(({ areLinesCut }: WrappedTextToMeasure) => areLinesCut === true);
  let cellsInWrapAreas = wrapAreas
    .filter(
      ({ rows }: IndexRunsOfEntry) =>
        rows.some(({ firstIndex, count }) => isInSpan(rowIndex, firstIndex, count)),
    )
    .flatMap(
      ({ columns }: IndexRunsOfEntry) =>
        columns.flatMap(
          ({ firstIndex, count }) =>
            reads.cellsOnShowIn(sheet.sheetId, {
              topRowIndex: rowIndex,
              rowCount: 1,
              leftColumnIndex: firstIndex,
              columnCount: count,
            }),
        ),
    );
  let texts = cellsInWrapAreas.flatMap((cellId: CellId) => wrappedTextToMeasure(cellId, sheet, reads) ?? []);
  let heightsForPeople = cellsInWrapAreas.map((cellId: CellId) => {
    if (usersOfCell(reads.cellOf(cellId)).length < 2) return 0;
    let position = reads.positionOfCell(cellId);
    if (position === null || reads.mergedAreaAt(cellId.sheetId, position) !== null) return 0;
    let columnWidth = sheet.columnEdges.sizeOf(position.columnIndex);
    return heightForPeopleInCell(cellId, columnWidth, reads, density);
  });
  return {
    texts: [...texts, ...listTexts],
    heightForPeople: Math.max(0, ...heightsForPeople),
  };
}
export function wrappedRowsInSight(
  sheetId: SheetId,
  wrapAreas: readonly IndexRunsOfEntry[],
  reads: WorkbookReads,
): Map<RowId, RowAsItStands> {
  let rows = reads.rowsAsTheyStand(sheetId);
  let wrapRowRuns = wrapAreas.flatMap(({ rows: rowRuns }: IndexRunsOfEntry) => rowRuns);
  let rowLines = reads.linesOf(sheetId)?.rows;
  if (rowLines === undefined || wrapRowRuns.reduce((total: number, { count }) => total + count, 0) >= rows.size)
    return rows;
  let rowsInSight = new Map<RowId, RowAsItStands>();
  for (let { firstIndex, count } of wrapRowRuns)
    for (let rowIndex = firstIndex; rowIndex < firstIndex + count; rowIndex += 1) {
      let rowId = rowLines.idAt(rowIndex);
      let row = rowId === null ? undefined : rows.get(rowId);
      if (rowId !== null && row !== undefined) rowsInSight.set(rowId, row);
    }
  for (let rowId of reads.cellsWithListsIn(sheetId).keys()) {
    let row = rows.get(rowId);
    if (row !== undefined) rowsInSight.set(rowId, row);
  }
  return rowsInSight;
}
export function lineCountsOfTexts(texts: readonly WrappedTextToMeasure[], measurer: TextMeasurer): number[] {
  let measured = texts.filter(({ areLinesCut }: WrappedTextToMeasure) => areLinesCut !== true);
  let counts = (measured.length === 0 ? [] : measurer.lineCountsOfWrappedTexts(measured)).values();
  return texts.map(
    ({ areLinesCut, levelsInLists = [] }: WrappedTextToMeasure) =>
      areLinesCut === true ? levelsInLists.length : (counts.next().value ?? 1),
  );
}
export function rowGrowthsOfTexts(texts: readonly WrappedTextToMeasure[], measurer: TextMeasurer, density: CellDensity): number[] {
  let lineCounts = lineCountsOfTexts(texts, measurer);
  return texts.map(({ font, levelsInLists = [null] }: WrappedTextToMeasure, index: number) => {
    let lineCount = lineCounts[index] ?? 1;
    let linesWithGaps = lineCountWithListGaps(lineCount, levelsInLists.length, font.size);
    return lineCount === 1 ? 0 : rowHeightForLinesAtDensity(linesWithGaps, font.size, density);
  });
}
export function rowGrowthCacheOf(sheet: SheetSummary, { lineCountsOfWrappedTexts }: TextMeasurer, density: CellDensity): RowGrowthCache {
  let bySheet = ROW_GROWTH_CACHES[density].get(lineCountsOfWrappedTexts);
  if (bySheet === undefined) {
    bySheet = new WeakMap<SheetSummary, RowGrowthCache>();
    ROW_GROWTH_CACHES[density].set(lineCountsOfWrappedTexts, bySheet);
  }
  let cache = bySheet.get(sheet);
  if (cache === undefined) {
    cache = new WeakMap<RowAsItStands, TallRow>();
    bySheet.set(sheet, cache);
  }
  return cache;
}
export function measureWrappedRowGrowth(
  rows: ReadonlyMap<RowId, RowAsItStands>,
  wrapAreas: readonly IndexRunsOfEntry[],
  sheet: SheetSummary,
  book: ReadsWithTextMeasurer,
  density: CellDensity,
): TallRow[] {
  let cache = rowGrowthCacheOf(sheet, book, density);
  let growths: TallRow[] = [];
  let toMeasure: RowToMeasure[] = [];
  for (let [rowId, row] of rows) {
    let cached = cache.get(row);
    if (cached !== undefined) {
      growths.push(cached);
      continue;
    }
    let rowIndex = book.rowIndexOf(sheet.sheetId, rowId);
    let textsAndPeople =
      rowIndex === null
        ? {
            texts: [],
            heightForPeople: 0,
          }
        : wrappedTextsAndPeopleInRow(rowId, rowIndex, wrapAreas, sheet, book, density);
    if (rowIndex === null || (textsAndPeople.texts.length === 0 && textsAndPeople.heightForPeople === 0)) cache.set(row, NO_ROW_GROWTH);
    else
      toMeasure.push({
        row,
        rowIndex,
        ...textsAndPeople,
      });
  }
  let rowGrowths = rowGrowthsOfTexts(
    toMeasure.flatMap(({ texts }: RowToMeasure) => texts),
    book,
    density,
  );
  let countIndex = 0;
  for (let { row, rowIndex, texts, heightForPeople } of toMeasure) {
    let growthsOfRow = rowGrowths.slice(countIndex, countIndex + texts.length);
    countIndex += texts.length;
    let heightInPixels = Math.max(heightForPeople, ...growthsOfRow);
    let growth =
      heightInPixels === 0
        ? NO_ROW_GROWTH
        : {
            rowIndex,
            heightInPixels,
          };
    cache.set(row, growth);
    growths.push(growth);
  }
  return growths.filter((growth: TallRow) => growth !== NO_ROW_GROWTH);
}
export function wrappedRowHeightsOfSheet(sheet: SheetSummary, book: ReadsWithTextMeasurer, density: CellDensity): TallRow[] {
  if (!mayRowsGrowInSheet(sheet.sheetId, book)) return [];
  let wrapAreas = book.whereTextWraps(sheet.sheetId);
  let rowsInWrapAreas = wrappedRowsInSight(sheet.sheetId, wrapAreas, book);
  let heights = measureWrappedRowGrowth(rowsInWrapAreas, wrapAreas, sheet, book, density);
  heights.sort((height: TallRow, otherHeight: TallRow) => height.rowIndex - otherHeight.rowIndex);
  return heights;
}
export function wrappedHeightOfRow(rowId: RowId, sheet: SheetSummary | undefined, book: ReadsWithTextMeasurer, density: CellDensity): number {
  if (sheet === undefined) return 0;
  let wrapAreas = book.whereTextWraps(sheet.sheetId);
  let row = book.rowsAsTheyStand(sheet.sheetId).get(rowId);
  if (!mayRowsGrowInSheet(sheet.sheetId, book) || row === undefined) return 0;
  let [measured] = measureWrappedRowGrowth(new Map([[rowId, row]]), wrapAreas, sheet, book, density);
  return measured?.heightInPixels ?? 0;
}
export const mayRowsGrowInSheet = (sheetId: SheetId, reads: WorkbookReads): boolean =>
  reads.whereTextWraps(sheetId).length > 0 || reads.cellsWithListsIn(sheetId).size > 0;
export const NO_ROW_GROWTH: TallRow = {
  rowIndex: -1,
  heightInPixels: 0,
};
/** The rows grown for wrapped text, by density, by the measurer of wrapped text and by sheet. */
export const ROW_GROWTH_CACHES: Record<CellDensity, WeakMap<TextMeasurer['lineCountsOfWrappedTexts'], WeakMap<SheetSummary, RowGrowthCache>>> = {
  comfortable: new WeakMap<TextMeasurer['lineCountsOfWrappedTexts'], WeakMap<SheetSummary, RowGrowthCache>>(),
  compact: new WeakMap<TextMeasurer['lineCountsOfWrappedTexts'], WeakMap<SheetSummary, RowGrowthCache>>(),
};
