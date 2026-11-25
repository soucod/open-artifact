import { numberFormatOfChoice } from './number-format-choices.ts';
import { isCheckboxFormat, booleanOfValue } from '../chips/checkboxes.ts';
import { wrappingOfWrapText } from '../grid/text-overflow.ts';
import type { PatternsOfChoices } from './number-format-choices.ts';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellFormat, HorizontalAlignment, ValueContents } from '@open-artifact/sheets-core';
/** Where a cell's text is drawn across it, once a general alignment is worked out from its value. */
export type ShownHorizontalAlignment = Exclude<HorizontalAlignment, 'general'>;
export function generalAlignmentOf(value: ValueContents | null): ShownHorizontalAlignment {
  switch (value?.kind) {
    case 'number':
      return 'right';
    case 'boolean':
    case 'error':
      return 'center';
    case 'text':
    case undefined:
      return 'left';
  }
}
export function formatOfToolbarChoice(choice: CellFormatChoice, reads: PatternsOfChoices): CellFormat {
  if (choice.bold !== undefined)
    return {
      font: {
        bold: choice.bold,
      },
    };
  if (choice.italic !== undefined)
    return {
      font: {
        italic: choice.italic,
      },
    };
  if (choice.underline !== undefined)
    return {
      font: {
        underline: choice.underline,
      },
    };
  if (choice.strikethrough !== undefined)
    return {
      font: {
        strikethrough: choice.strikethrough,
      },
    };
  if (choice.textColor !== undefined)
    return {
      font: {
        color: choice.textColor,
      },
    };
  if (choice.fontSizeInPoints !== undefined)
    return {
      font: {
        size: choice.fontSizeInPoints,
      },
    };
  if (choice.horizontalAlignment !== undefined)
    return {
      alignment: {
        horizontal: choice.horizontalAlignment,
      },
    };
  if (choice.verticalAlignment !== undefined)
    return {
      alignment: {
        vertical: choice.verticalAlignment,
      },
    };
  if (choice.wrapText !== undefined)
    return {
      alignment: {
        wrap: wrappingOfWrapText(choice.wrapText),
      },
    };
  if (choice.fillColor !== undefined)
    return {
      fillColor: choice.fillColor,
    };
  if (choice.customNumberFormat !== undefined)
    return {
      numberFormat: choice.customNumberFormat,
    };
  if (choice.decimalPlaces !== undefined)
    return {
      numberFormat: {
        pattern: choice.decimalPlaces.pattern,
      },
    };
  return {
    numberFormat: numberFormatOfChoice(choice.numberFormatChoice!, reads),
  };
}
export const HORIZONTAL_ALIGNMENTS: HorizontalAlignment[] = ['left', 'center', 'right', 'general'];
export const resolvedHorizontalAlignment = (alignment: HorizontalAlignment, value: ValueContents | null): ShownHorizontalAlignment =>
  alignment === 'general' ? generalAlignmentOf(value) : alignment;
export const shownHorizontalAlignment = (format: Pick<WholeCellFormat, 'cellControl' | 'alignment'>, value: ValueContents | null): ShownHorizontalAlignment =>
  isCheckboxFormat(format) && booleanOfValue(value) !== null ? 'center' : resolvedHorizontalAlignment(format.alignment.horizontal, value);
