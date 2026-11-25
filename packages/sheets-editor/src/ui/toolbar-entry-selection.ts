import type { FormatCommand } from '../format/format-commands.ts';
export const FORMAT_MENUS_KEEPING_ENTRY_SELECTION = new Set<string>([
  'fontSize',
  'align',
  'textWrapping',
  'numberFormat',
  'textColor',
  'fillColor',
  'borders',
]);
export const isFormatMenuKeepingEntrySelection = (menuName: string) => FORMAT_MENUS_KEEPING_ENTRY_SELECTION.has(menuName);
export const isFormatChoiceKeepingEntrySelection = (choice: FormatCommand) =>
  !('toggle' in choice) && !('checkbox' in choice) && !('dateToPick' in choice) && !('removesDropdown' in choice);
