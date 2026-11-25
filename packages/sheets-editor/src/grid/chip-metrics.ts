import type { CellDensity } from './cell-metrics-values.ts';
import type { TextInsets } from './cell-metrics.ts';
import { firstLineHeight, CELL_PADDING_BY_DENSITY, GRIDLINE_THICKNESS } from './cell-metrics-values.ts';
import { MAX_CHIP_BEYOND_LINE, chipBeyondLine } from './cell-metrics.ts';
import { MAX_ROW_HEIGHT } from '../model/line-sizes.ts';
export function rowHeightForPersonChipLines(lineCount: number, fontSize: number, density: CellDensity): number {
  let padding = CELL_PADDING_BY_DENSITY[density];
  let lineGap = PERSON_CHIP_LINE_GAP + chipBeyondLine(padding);
  let linesHeight = lineCount * firstLineHeight(fontSize) + (lineCount - 1) * lineGap;
  return Math.min(MAX_ROW_HEIGHT, padding.over + linesHeight + padding.under + GRIDLINE_THICKNESS);
}
export function personChipLinesInRowHeight(rowHeight: number, fontSize: number, padding: Pick<TextInsets, 'over' | 'under'>): number {
  let lineHeight = firstLineHeight(fontSize);
  let lineGap = PERSON_CHIP_LINE_GAP + chipBeyondLine(padding);
  let room = rowHeight - padding.over - padding.under - GRIDLINE_THICKNESS;
  return Math.max(1, Math.floor((room + lineGap) / (lineHeight + lineGap)));
}
export const DROPDOWN_PILL_PADDING = 8;
export const DROPDOWN_ARROW_GAP = 3;
export const DROPDOWN_ARROW_WIDTH = 12;
export const PERSON_CHIP_END_PADDING = 8;
export const PERSON_CHIP_ARROW_GAP = 4;
export const PERSON_AVATAR_SIZE = 16;
export const PERSON_AVATAR_GAP = 4;
export const personChipInsetY = (fontSize: number): number =>
  Math.ceil((firstLineHeight(fontSize) + MAX_CHIP_BEYOND_LINE - PERSON_AVATAR_SIZE) / 2);
export const personChipWidth = (opensList: boolean, fontSize: number): number =>
  personChipInsetY(fontSize) +
  PERSON_AVATAR_SIZE +
  PERSON_AVATAR_GAP +
  (opensList ? PERSON_AVATAR_GAP + DROPDOWN_ARROW_WIDTH + PERSON_CHIP_ARROW_GAP : PERSON_CHIP_END_PADDING);
export const PERSON_CHIP_GAP = 4;
export const PERSON_CHIP_LINE_GAP = 4;
export const personChipsWidth = (count: number, opensList: boolean, fontSize: number): number =>
  personChipWidth(opensList, fontSize) + (count - 1) * (PERSON_CHIP_GAP + personChipWidth(false, fontSize));
export const dropdownChipExtraWidth = (isOption: boolean, hasArrow: boolean): number =>
  (isOption ? DROPDOWN_PILL_PADDING : 0) + (isOption || hasArrow ? DROPDOWN_ARROW_GAP : 0) + (hasArrow ? DROPDOWN_ARROW_WIDTH : 0);
