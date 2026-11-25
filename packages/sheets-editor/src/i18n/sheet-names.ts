import { translateMessage } from './messages.ts';
/** The text a copied sheet's name puts before and after the name of the sheet it copies. */
export interface CopiedSheetNameAffixes {
  beforeName: string;
  afterName: string;
}
export function copiedSheetNameAffixes(): CopiedSheetNameAffixes {
  let [beforeName = '', afterName = ''] = copiedSheetName(SHEET_NAME_PLACEHOLDER).split(SHEET_NAME_PLACEHOLDER);
  return {
    beforeName,
    afterName,
  };
}
export const defaultSheetName = (): string =>
  translateMessage({
    defaultMessage: 'Sheet',
    id: '5oHo/izHhB',
  });
export const copiedSheetName = (sheetName: string): string =>
  translateMessage(
    {
      defaultMessage: '{name} (copy)',
      id: 'T5o8lrUVTN',
    },
    {
      name: sheetName,
    },
  );
export const SHEET_NAME_PLACEHOLDER = '\x00';
