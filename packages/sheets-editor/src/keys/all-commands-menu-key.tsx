import type { MouseEventHandler } from 'react';
import type { Menu } from '../state/initial-state.ts';
import type { KeyWithModifiers } from './key-press.ts';
import { useCoarseBarIconSize, BarIconButton } from '../ui/bar-buttons.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
/** A press of the key that opens and shuts the menu of all commands, with what the page holds when it comes. */
export interface AllCommandsMenuKeyPress {
  isPointerCoarse: boolean;
  canPersonEdit: boolean;
  /** The key was pressed in the cells, not in a field of its own. */
  isFromCells: boolean;
  menu: Menu | null;
  isRepeat: boolean;
}
/** What the key does to the menu of all commands: nothing, shut it, or open it. */
export type AllCommandsMenuKeyOutcome = 'nothing' | 'shuts' | 'opens';
export interface HideKeyboardButtonProps {
  onPressed: MouseEventHandler<HTMLButtonElement>;
}
export function allCommandsMenuKeyAction(press: AllCommandsMenuKeyPress): AllCommandsMenuKeyOutcome | null {
  if (press.isPointerCoarse || !press.canPersonEdit) return null;
  let isAllMenuOpen = press.menu?.holds === 'all' && press.menu.isOfContextBar !== true;
  if (!isAllMenuOpen && !press.isFromCells) return null;
  if (press.isRepeat) return 'nothing';
  return isAllMenuOpen ? 'shuts' : 'opens';
}
export function HideKeyboardButton({ onPressed }: HideKeyboardButtonProps) {
  return <span className="sheet-hide-keyboard -my-1 flex flex-none border-s border-divider py-1 ps-1 transition-opacity duration-base ease-out motion-reduce:transition-none starting:opacity-0" data-size={useCoarseBarIconSize()}><BarIconButton icon="Keyboard" label={sheetMessages.hideKeyboard()} tooltipSide="top" whyNot={null} onClick={onPressed} /></span>;
}
export const isAllCommandsMenuKey = (
  { key, code, shiftKey, altKey, metaKey, ctrlKey }: KeyWithModifiers,
  isMac: boolean,
): boolean => altKey && !shiftKey && !metaKey && !ctrlKey && (key === '/' || (isMac && key === '÷' && code === 'Slash'));
