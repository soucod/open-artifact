import type { SharedCellFormat } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellArea } from './model.ts';
import { selectionOfArea, activeAnchorCell, areaOfPosition, unionOfAreas, selectedArea } from './model.ts';
import { areasOverlap } from '../model/workbook.ts';
import { allRangesOf } from './several-ranges.ts';
import { isSelectionOneCell } from './keyboard.ts';
export function sharedFormatOfAreas(selection: PageState, reads: WorkbookReads, areas: readonly CellArea[]): SharedCellFormat | null {
  let [firstFormat, ...moreFormats] = areas.flatMap((area) => {
    let corners = selectionOfArea(selection, reads, area);
    if (corners === null) return [];
    return reads.sharedFormatBetween(corners.activeCell, corners.selectionCorner) ?? [];
  });
  return firstFormat === undefined ? null : moreFormats.reduce(commonFormatOf, firstFormat);
}
export function formatOfSelectionWithEntries(selection: PageState, reads: WorkbookReads, format: SharedCellFormat): SharedCellFormat {
  if (
    ![
      format.numberFormat,
      ...Object.values({
        ...format.font,
        ...format.alignment,
      }),
    ].includes(null)
  )
    return format;
  let typedCellAreas: CellArea[] = [
    ...(selection.mode.kind === 'editing' ? [activeAnchorCell(selection, reads)] : []),
    ...selection.entriesUnanswered.flatMap(({ cellId, text }) => (text === '' ? [] : cellId)),
  ].flatMap((cellId: CellId) => {
    let position = cellId.sheetId === selection.sheetId ? reads.positionOfCell(cellId) : null;
    return position === null ? [] : areaOfPosition(position);
  });
  let formatAreas = formatAreasOfAllRanges(selection, reads).flatMap((area) => {
    let shownArea = reads.areaOnShowIn(selection.sheetId, area);
    let [firstArea, ...moreAreas] = [
      ...(shownArea === null ? [] : [shownArea]),
      ...typedCellAreas.filter((typedArea) => areasOverlap(area, typedArea)),
    ];
    return firstArea === undefined ? [] : moreAreas.reduce(unionOfAreas, firstArea);
  });
  let { font, numberFormat, alignment } = sharedFormatOfAreas(selection, reads, formatAreas) ?? format;
  return {
    ...format,
    font,
    numberFormat,
    alignment,
  };
}
export const sameJsonOrNull = <T>(value: T, otherValue: T): T | null => (JSON.stringify(value) === JSON.stringify(otherValue) ? value : null);
export const commonFormatOf = (format: SharedCellFormat, otherFormat: SharedCellFormat): SharedCellFormat => ({
  numberFormat: sameJsonOrNull(format.numberFormat, otherFormat.numberFormat),
  alignment: {
    horizontal: sameJsonOrNull(format.alignment.horizontal, otherFormat.alignment.horizontal),
    vertical: sameJsonOrNull(format.alignment.vertical, otherFormat.alignment.vertical),
    wrap: sameJsonOrNull(format.alignment.wrap, otherFormat.alignment.wrap),
  },
  fillColor: sameJsonOrNull(format.fillColor, otherFormat.fillColor),
  cellControl: sameJsonOrNull(format.cellControl, otherFormat.cellControl),
  border: {
    top: sameJsonOrNull(format.border.top, otherFormat.border.top),
    right: sameJsonOrNull(format.border.right, otherFormat.border.right),
    bottom: sameJsonOrNull(format.border.bottom, otherFormat.border.bottom),
    left: sameJsonOrNull(format.border.left, otherFormat.border.left),
  },
  font: {
    bold: sameJsonOrNull(format.font.bold, otherFormat.font.bold),
    italic: sameJsonOrNull(format.font.italic, otherFormat.font.italic),
    underline: sameJsonOrNull(format.font.underline, otherFormat.font.underline),
    strikethrough: sameJsonOrNull(format.font.strikethrough, otherFormat.font.strikethrough),
    color: sameJsonOrNull(format.font.color, otherFormat.font.color),
    size: sameJsonOrNull(format.font.size, otherFormat.font.size),
  },
});
export const formatAreasOfAllRanges = (selection: PageState, reads: WorkbookReads): CellArea[] =>
  allRangesOf(selection).flatMap((range): CellArea | CellArea[] => {
    let mergedArea = selectedArea(range, reads);
    if (mergedArea === null || !isSelectionOneCell(range, reads)) return mergedArea ?? [];
    let { topRowIndex, leftColumnIndex } = mergedArea;
    return {
      topRowIndex,
      leftColumnIndex,
      rowCount: 1,
      columnCount: 1,
    };
  });
export const sharedFormatOfAllRanges = (selection: PageState, reads: WorkbookReads): SharedCellFormat | null =>
  sharedFormatOfAreas(selection, reads, formatAreasOfAllRanges(selection, reads));
