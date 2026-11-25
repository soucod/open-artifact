import type { ListLine } from '@open-artifact/sheets-core';
import { levelInList } from '../model/cell-values.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { hasRoomForText } from '../grid/cell-metrics.ts';
import type { FontToMeasure, ReadsWithTextMeasurer } from '../state/controller.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
export function lineCountOfEntry(
  text: string,
  font: FontToMeasure,
  width: number,
  workbook: ReadsWithTextMeasurer,
  lists?: readonly ListLine[],
): number {
  let measured = text.endsWith(`
`)
    ? `${text}.`
    : text;
  let [lineCount = 1] = workbook.lineCountsOfWrappedTexts([
    {
      text: measured,
      font,
      widthInPixels: width,
      isStillTyped: true,
      ...(lists !== undefined && {
        levelsInLists: lists.map(levelInList),
      }),
      ...(isFormulaText(text) && {
        isFormulaTyped: true,
      }),
    },
  ]);
  return lineCount;
}
export const withLineBreakAt = (text: string, { start, end }: CaretSpan): { text: string; caretAt: number } => ({
  text: `${text.slice(0, start)}
${text.slice(end)}`,
  caretAt: start + 1,
});
export const wrapsWithinWidth = (width: number, { alignment, font }: Pick<WholeCellFormat, 'alignment' | 'font'>): boolean =>
  alignment.wrap === true && hasRoomForText(width, font.size);
