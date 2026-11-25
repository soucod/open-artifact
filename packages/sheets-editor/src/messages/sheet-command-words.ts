import { translateMessage } from '../i18n/messages.ts';
export const sheetWord = () =>
  translateMessage({
    defaultMessage: 'Sheet',
    id: '9z1mmIAgIh',
  });
export const blankSheetWord = () =>
  translateMessage({
    defaultMessage: 'Blank',
    id: 'xwWJ0fdwQu',
  });
export const SHEET_COMMAND_SYNONYM_MESSAGES = {
  versionHistory: () =>
    translateMessage({
      defaultMessage: 'history, versions, revisions, earlier, restore, go back',
      id: 'i98lyOwo7/',
    }),
  functions: () =>
    translateMessage({
      defaultMessage: 'formulas, fx, list of functions, sum function, insert function, function list, all functions, formula list, fn',
      id: 'Dv/Sk1k1Ph',
    }),
  allSheets: () =>
    translateMessage({
      defaultMessage: 'list of sheets, tabs, go to sheet, switch sheet',
      id: 'S8G7I+QAxJ',
    }),
  addBlank: () =>
    translateMessage({
      defaultMessage: 'new sheet, new tab, add tab, insert sheet, new page, add page',
      id: 'TZ3DjBz7D+',
    }),
  addFromFile: () =>
    translateMessage({
      defaultMessage: 'upload, open file, bring in',
      id: 'cjghhebMJ4',
    }),
  rename: () =>
    translateMessage({
      defaultMessage: 'name of sheet, rename tab, title',
      id: 'LJWarcxrrk',
    }),
  duplicate: () =>
    translateMessage({
      defaultMessage: 'copy sheet, copy tab, clone',
      id: '0g/mstwdIr',
    }),
  copyLink: () =>
    translateMessage({
      defaultMessage: 'share link, url, address, link to sheet',
      id: 'Vds1rsL3FP',
    }),
  move: () =>
    translateMessage({
      defaultMessage: 'reorder, order of tabs, move tab',
      id: 'RZNVQsU8hY',
    }),
  delete: () =>
    translateMessage({
      defaultMessage: 'remove sheet, remove tab, delete tab',
      id: 'IPsIC7mSWd',
    }),
  fill: () =>
    translateMessage({
      defaultMessage: 'copy down, copy across, repeat, drag, drag down',
      id: 'jLNnBNtkLL',
    }),
};
export type SheetCommandWithSynonyms = keyof typeof SHEET_COMMAND_SYNONYM_MESSAGES;
export const sheetCommandSynonyms = (command: SheetCommandWithSynonyms): string[] =>
  SHEET_COMMAND_SYNONYM_MESSAGES[command]()
    .split(/[,،、，]/)
    .map((synonym) => synonym.trim())
    .filter((synonym) => synonym !== '');
