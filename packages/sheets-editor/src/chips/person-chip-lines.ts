import { PERSON_CHIP_GAP, PERSON_CHIP_END_PADDING, personChipsWidth } from '../grid/chip-metrics.ts';
import { CELL_TEXT_PADDING_X } from '../grid/cell-metrics.ts';
/** People's chips in a cell, and the room there is for them. */
export interface PersonChipsLayout {
  cellWidth: number;
  nameWidths: readonly number[];
  widthOfCount(count: number): number;
  fontSizeInPoints: number;
  opensList: boolean;
}
/** People's chips in a cell, with how many lines of the cell they may take. */
export interface PersonChipsInLines extends PersonChipsLayout {
  lineCount: number;
}
export function lineCountOfChipWidths(widths: readonly number[], roomWidth: number): number {
  let [lineCount, lineWidth] = [1, 0];
  for (let [index, width] of widths.entries()) {
    let widened = lineWidth + PERSON_CHIP_GAP + width;
    if (index === 0) lineWidth = width;
    else if (widened <= roomWidth) lineWidth = widened;
    else [lineCount, lineWidth] = [lineCount + 1, width];
  }
  return lineCount;
}
export function personChipLineCount(chipCount: number, layout: PersonChipsLayout, isOneLine: boolean): number {
  let { cellWidth, nameWidths, widthOfCount, fontSizeInPoints, opensList } = layout;
  let chipWidths = nameWidths
    .slice(0, chipCount)
    .map((nameWidth, index) => nameWidth + personChipsWidth(1, index === 0 && opensList, fontSizeInPoints));
  let leftOut = nameWidths.length - chipCount;
  let countWidths = leftOut === 0 ? [] : [2 * PERSON_CHIP_END_PADDING + widthOfCount(leftOut)];
  let roomWidth = cellWidth - CELL_TEXT_PADDING_X - (isOneLine ? 0 : 1);
  return lineCountOfChipWidths([...chipWidths, ...countWidths], roomWidth);
}
export function personChipsFittingLines({ lineCount, ...layout }: PersonChipsInLines): number {
  for (let chipCount = layout.nameWidths.length; chipCount > 1; chipCount -= 1)
    if (personChipLineCount(chipCount, layout, lineCount === 1) <= lineCount) return chipCount;
  return 1;
}
export function personChipLinesNeeded(layout: Omit<PersonChipsLayout, 'widthOfCount'>): number {
  let withoutCount: PersonChipsLayout = {
    ...layout,
    widthOfCount: () => 0,
  };
  let chipCount = withoutCount.nameWidths.length;
  if (
    !hasRoomForPersonChipLines(withoutCount.cellWidth, withoutCount.fontSizeInPoints) ||
    personChipLineCount(chipCount, withoutCount, true) === 1
  )
    return 1;
  return personChipLineCount(chipCount, withoutCount, false);
}
export const MIN_ROOM_PAST_ONE_PERSON_CHIP = 16;
export const hasRoomForPersonChipLines = (cellWidth: number, fontSizeInPoints: number): boolean =>
  cellWidth - CELL_TEXT_PADDING_X >= personChipsWidth(1, true, fontSizeInPoints) + MIN_ROOM_PAST_ONE_PERSON_CHIP;
