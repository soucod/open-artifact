import type { SharedCellFormat, ValueContents } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { TextWrapping } from '../i18n/format-labels.ts';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
import type { TextMeasurer } from '../state/controller.ts';
import type { readCellLink } from '../links/cell-links.ts';
import type { TextAlignment } from './cell-metrics.ts';
import type { DrawnCell } from './grid-drawing.tsx';
import { listHeightForLines, textRoomInWidth } from './cell-metrics.ts';
import { colorsEqual } from '../model/colors.ts';
import { strongerBorder } from './borders.ts';
/** How a cell's text is laid out: cut at the cell's edges, wrapped onto more lines, or running on over the cells beside it. */
export type CellTextLayout = 'clip' | 'wrap' | 'overflow';
/** How a link in a cell is drawn: as the cell's words, or as its address, typed with a scheme or without one. */
export type LinkDrawnAs = NonNullable<ReturnType<typeof readCellLink>>['drawnAs'];
/** What tells how a cell's text is laid out. */
export interface CellTextLayoutAsks {
  isMerged: boolean;
  isTypedIn: boolean;
  isOfDropdown: boolean;
  hasFilterButton: boolean;
  isPerson: boolean;
  linkDrawnAs: LinkDrawnAs | null;
  isFormulaShown: boolean;
  wrappingByFormat: TextWrapping;
  holdsList: boolean;
  hasRoomToWrap: boolean;
}
/** How far, in pixels, a cell's text runs on past the cell at its left and at its right. */
export interface TextReachPastCell {
  toLeft: number;
  toRight: number;
}
/** The width a text running on to the right is given, and whether it shares the room with the text of the next cell. */
export interface OverflowWidth {
  width: number;
  isShared: boolean;
}
/** Of a drawn cell, what tells whether its text may be drawn as fading where it is cut. */
export type TextOfCellToFade = Pick<
  DrawnCell,
  | 'text'
  | 'textWidth'
  | 'textCutByViewAt'
  | 'indentToCenter'
  | 'mergedColumnCount'
  | 'takenAtRight'
  | 'isTextWrapped'
  | 'isPerson'
  | 'pill'
  | 'opensDropdownList'
  | 'linkDrawnAs'
> & { format: Pick<WholeCellFormat, 'font'> };
/** The parts of a format that tell whether a text may run on from one cell into the next. */
export type FormatForOverflow = Pick<WholeCellFormat, 'fillColor' | 'border' | 'cellControl'>;
export function flattenLineBreaksAcrossParts(texts: readonly string[]): string[] {
  let lineBreaks = [...texts.join('').matchAll(LINE_BREAK_RUN_PATTERN)];
  let position = 0;
  return texts.map((text: string) => {
    let [start, end] = [position, position + text.length];
    position = end;
    let [flattened, copiedTo] = ['', start];
    for (let { 0: lineBreak, index: breakAt } of lineBreaks) {
      let breakEnd = breakAt + lineBreak.length;
      if (breakEnd <= start || breakAt >= end) continue;
      flattened += text.slice(copiedTo - start, Math.max(breakAt, start) - start) + (breakAt >= start ? ' ' : '');
      copiedTo = Math.min(breakEnd, end);
    }
    return flattened + text.slice(copiedTo - start);
  });
}
export function textOverflowAround(
  layout: CellTextLayout,
  alignment: TextAlignment,
  text: string,
  cellWidth: number,
  fontSize: number,
): TextReachPastCell {
  switch (layout) {
    case 'clip':
    case 'wrap':
      return NO_TEXT_OVERFLOW;
    case 'overflow': {
      let spare = listHeightForLines(text, fontSize) - cellWidth;
      if (spare <= 0) return NO_TEXT_OVERFLOW;
      if (alignment === 'center')
        return {
          toLeft: spare / 2,
          toRight: spare / 2,
        };
      return alignment === 'left'
        ? {
            toLeft: 0,
            toRight: spare,
          }
        : {
            toLeft: spare,
            toRight: 0,
          };
    }
  }
}
export function shareOverflowWidth(available: number, ownWidth: number, otherWidth: number): OverflowWidth {
  let total = ownWidth + otherWidth;
  return total <= available || otherWidth === 0
    ? {
        width: ownWidth,
        isShared: false,
      }
    : {
        width: (available * ownWidth) / total,
        isShared: true,
      };
}
export function canTextFadeInCell(cellText: TextOfCellToFade): boolean {
  let hasChip = cellText.pill !== null || cellText.opensDropdownList;
  let isLinkAddress = cellText.linkDrawnAs !== null && cellText.linkDrawnAs !== 'words';
  let isMerged = cellText.mergedColumnCount !== null;
  return !(cellText.isTextWrapped || cellText.isPerson || hasChip || isLinkAddress || isMerged);
}
export function wrappingOfWrapText(wrapText: WholeCellFormat['alignment']['wrap']): TextWrapping {
  if (wrapText === 'clip') return wrapText;
  return wrapText ? 'wrap' : 'overflow';
}
export function mayTextFade(cellText: TextOfCellToFade, measurer: Pick<TextMeasurer, 'widthOfCharacters'>): boolean {
  let { text, format } = cellText;
  if (!canTextFadeInCell(cellText)) return false;
  let room = cellText.textWidth - Math.abs(cellText.indentToCenter) - cellText.takenAtRight;
  if (listHeightForLines(text, format.font.size) <= room) return false;
  let maxCharacters = textRoomInWidth(room);
  return (
    text.length > maxCharacters ||
    UNMEASURED_SCRIPT_PATTERN.test(text) ||
    measurer.widthOfCharacters(flattenLineBreaks(text), format.font) * TEXT_WIDTH_SAFETY_FACTOR > maxCharacters
  );
}
export const cellTextLayout = (
  value: ValueContents | null,
  {
    isMerged,
    isTypedIn,
    isOfDropdown,
    hasFilterButton,
    isPerson,
    linkDrawnAs,
    isFormulaShown,
    wrappingByFormat,
    holdsList,
    hasRoomToWrap,
  }: CellTextLayoutAsks,
): CellTextLayout => {
  if (value?.kind !== 'text' || isMerged || isTypedIn || isOfDropdown || isPerson || (linkDrawnAs !== null && linkDrawnAs !== 'words')) return 'clip';
  if ((wrappingByFormat === 'overflow' && !holdsList) || isFormulaShown) return linkDrawnAs === null && !hasFilterButton ? 'overflow' : 'clip';
  return (wrappingByFormat === 'wrap' || holdsList) && hasRoomToWrap ? 'wrap' : 'clip';
};
export const LINE_BREAK_RUN_PATTERN = /(?<![ \t])[ \t]*[\r\n][ \t\r\n]*/g;
export const flattenLineBreaks = (text: string): string => text.replaceAll(LINE_BREAK_RUN_PATTERN, ' ');
export const NO_TEXT_OVERFLOW: TextReachPastCell = {
  toLeft: 0,
  toRight: 0,
};
export const cellsJoinForOverflow = (format: FormatForOverflow, nextFormat: FormatForOverflow, checksDropdowns: boolean): boolean =>
  colorsEqual(format.fillColor, nextFormat.fillColor) &&
  strongerBorder(format.border.right, nextFormat.border.left) === null &&
  !(checksDropdowns && [format, nextFormat].some((cellFormat: FormatForOverflow) => cellFormat.cellControl.kind === 'dropdown'));
export const UNMEASURED_SCRIPT_PATTERN = /[^ -\u052f\u2000-\u206f]/;
export const TEXT_WIDTH_SAFETY_FACTOR = 1.1;
export const mayCellTextFade = (cellText: TextOfCellToFade, measurer: Pick<TextMeasurer, 'widthOfCharacters'>): boolean =>
  cellText.textCutByViewAt === null ? mayTextFade(cellText, measurer) : cellText.text !== '' && canTextFadeInCell(cellText);
export const TEXT_WRAPPING_CHOICES: TextWrapping[] = ['overflow', 'wrap', 'clip'];
export const WRAP_TEXT_OF_WRAPPING: Record<TextWrapping, NonNullable<CellFormatChoice['wrapText']>> = {
  overflow: false,
  wrap: true,
  clip: 'clip',
};
export const textWrappingOf = ({ alignment: { wrap: wrapText } }: Pick<SharedCellFormat, 'alignment'>): TextWrapping | null =>
  wrapText === null ? null : wrappingOfWrapText(wrapText);
export const textWrappingChange = (wrapping: TextWrapping): Pick<CellFormatChoice, 'wrapText'> => ({
  wrapText: WRAP_TEXT_OF_WRAPPING[wrapping],
});
