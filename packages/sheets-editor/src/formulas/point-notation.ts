import type { CellContents, DecimalSignName } from '@open-artifact/sheets-core';
import type { LocaleHelpers } from '../model/workbook.ts';
import { findFormulaReferences } from './references.ts';
/** The cell's formula written with `.` decimals and `,` between arguments, or `null` where it cannot surely be. */
export function formulaInPointNotation(
  { input, formulaText }: Pick<CellContents, 'input' | 'formulaText'>,
  decimalSign: DecimalSignName,
  formulaAsTyped: LocaleHelpers['formulaAsTyped'],
): string | null {
  if (input.kind !== 'formula' || formulaText === undefined) return null;
  if (decimalSign === 'point') return formulaText;
  let { references, quoted } = findFormulaReferences(formulaText, decimalSign);
  let textOutsideQuotes = quoted.reduce(
    (text, { start, end }) => text.slice(0, start) + ' '.repeat(end - start) + text.slice(end),
    formulaText,
  );
  if (quoted.some(({ isClosed }) => !isClosed)) return null;
  if (/,|\d\.|\.\d/.test(textOutsideQuotes)) return null;
  let { textBetweenReferences, references: formulaReferences } = input.formula;
  let pointText = '';
  let offset = 0;
  for (let [referenceIndex, between] of textBetweenReferences.entries()) {
    pointText += between;
    offset += between.length;
    if (referenceIndex === formulaReferences.length) break;
    let referenceEnd = formulaText.startsWith(REF_ERROR_TEXT, offset)
      ? offset + REF_ERROR_TEXT.length
      : references.find(({ start }) => start === offset)?.end;
    if (referenceEnd === undefined) return null;
    pointText += formulaText.slice(offset, referenceEnd);
    offset = referenceEnd;
  }
  return offset === formulaText.length && formulaAsTyped(pointText) === formulaText ? pointText : null;
}
export const REF_ERROR_TEXT = '#REF!';
