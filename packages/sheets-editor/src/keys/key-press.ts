import type { KeyPress } from '../state/event-reducer.ts';
import { shortcutKeysFor } from './shortcut-list.ts';

/** The fields of a keyboard event, DOM or React, that key handling reads. */
export type KeyEventFields = Pick<
  KeyboardEvent,
  'key' | 'code' | 'keyCode' | 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'repeat' | 'getModifierState'
>;
/** The modifier keys of a keyboard event. */
export type ModifierFields = Pick<KeyEventFields, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>;
/** A key with its physical code and modifiers. */
export type KeyWithModifiers = Pick<KeyEventFields, 'key' | 'code'> & ModifierFields;
/** One of the commands whose shortcut holds the command key and Alt together. */
export type AltCommandAct = (typeof ALT_COMMAND_ACTS)[number];
/** The shortcut of a command that holds Alt, split into its parts. */
export interface AltCommandShortcut {
  act: AltCommandAct;
  key: string;
  isWithCommand: boolean;
  isWithAlt: boolean;
  isWithShift: boolean;
}
export function latinKeyOf(
  { key, code, altKey: isAltHeld, shiftKey: isShiftHeld, ctrlKey: isCtrlHeld }: Pick<KeyWithModifiers, 'key' | 'code' | 'altKey' | 'shiftKey' | 'ctrlKey'>,
  isShortcut: boolean,
): string {
  if (!isShortcut || isAltHeld) return key;
  let letter = KEY_LETTER_CODE_PATTERN.exec(code)?.[1];
  if (letter !== undefined && !isAsciiKey(key)) return letter.toLowerCase();
  if (code === 'Semicolon' && !isAsciiKey(key)) return ';';
  if (code === 'Backquote' && (!isAsciiKey(key) || key === 'Dead')) return '`';
  let digit = isShiftHeld && !SIGN_KEY_PATTERN.test(key) ? DIGIT_CODE_PATTERN.exec(code)?.[1] : undefined;
  if (digit === undefined) return key;
  return isCtrlHeld ? digit : code;
}
export function signOfMacAltKey(key: string, code: string, keyCode: number): string {
  return (code === 'Equal' ? key === '=' || key === '≠' : code === 'Minus' && (key === '-' || key === '–')) ? (KEY_CODE_SIGNS[keyCode] ?? '') : '';
}
export function altCommandKeyOf(event: KeyEventFields, isMac: boolean): string | null {
  let { key, code, keyCode, altKey: isAltHeld, shiftKey: isShiftHeld, ctrlKey: isCtrlHeld, metaKey: isMetaHeld } = event;
  if (!isAltHeld || isMetaHeld !== isMac || isCtrlHeld === isMac) return null;
  if (isMac ? isShiftHeld : event.getModifierState('AltGraph') || NUMPAD_CODE_PATTERN.test(code)) return null;
  if (key === 'Enter') return key;
  let commandKey = isMac ? signOfMacAltKey(key, code, keyCode) : key;
  return isAltCommandKey(commandKey) ? commandKey : null;
}
export function readKeyPress(event: KeyEventFields, isMac: boolean): KeyPress {
  let { key, code, altKey: isAltKeyHeld, shiftKey: isShiftHeld, ctrlKey: isCtrlHeld, repeat: isRepeat } = event;
  let altCommandKey = altCommandKeyOf(event, isMac);
  if (altCommandKey !== null)
    return {
      key: altCommandKey,
      isShiftHeld,
      isModifierHeld: true,
      isAltHeld: true,
      isRepeat,
    };
  let isCommand = isCommandHeld(event);
  let isAltHeld = isAltKeyHeld && !isCtrlHeld && !(isMac && key === '=');
  let latinKey = latinKeyOf(event, isCommand);
  return {
    key: isCommand && isAltHeld && isAltCommandKey(latinKey) ? code : latinKey,
    isShiftHeld,
    isModifierHeld: isCommand,
    isAltHeld,
    isRepeat,
  };
}
export function isFillDownOrRightKey(event: KeyWithModifiers, isMac: boolean): boolean {
  let isCommand = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey;
  let hasNoOtherModifier = !event.shiftKey && !event.altKey;
  return isCommand && hasNoOtherModifier && ['d', 'r'].includes(latinKeyOf(event, true).toLowerCase());
}
export function isBrowserReservedKey(event: KeyWithModifiers): boolean {
  if (/^F(?:5|11|12)$/.test(event.key)) return event.key !== 'F11' || !event.shiftKey;
  let latinKey = latinKeyOf(event, true);
  return (event.ctrlKey || event.metaKey) && (/^[tnwq]$/i.test(latinKey) || (event.shiftKey && /^r$/i.test(latinKey)) || isZoomKey(event));
}
export const ALT_COMMAND_ACTS = ['insertRowsOrColumns', 'deleteRowsOrColumns', 'clearFormatting', 'addSheet'] as const;
export const shortcutFor = (act: string): string => shortcutKeysFor(act);
export const ALT_COMMAND_SHORTCUTS = ALT_COMMAND_ACTS.map((act): AltCommandShortcut => {
  let parts = shortcutFor(act).split('+');
  let key = parts.at(-1) ?? '';
  return {
    act,
    key: /^f\d+$/.test(key) ? key.toUpperCase() : key,
    isWithCommand: parts.includes('cmd'),
    isWithAlt: parts.includes('alt'),
    isWithShift: parts.includes('shift'),
  };
});
export const isAltCommandKey = (key: string): boolean =>
  ALT_COMMAND_SHORTCUTS.some((shortcut) => shortcut.isWithCommand && shortcut.isWithAlt && shortcut.key === key);
export const altCommandActOf = ({
  key,
  isShiftHeld,
  isModifierHeld,
  isAltHeld,
}: KeyPress): AltCommandAct | null =>
  ALT_COMMAND_SHORTCUTS.find(
    (shortcut) =>
      shortcut.key === key &&
      shortcut.isWithCommand === isModifierHeld &&
      shortcut.isWithAlt === isAltHeld &&
      ((isModifierHeld && isAltHeld) || shortcut.isWithShift === isShiftHeld),
  )?.act ?? null;
export const KEY_LETTER_CODE_PATTERN = /^Key([A-Z])$/;
export const DIGIT_CODE_PATTERN = /^Digit([0-9])$/;
export const NUMPAD_CODE_PATTERN = /^Numpad/;
export const SIGN_KEY_PATTERN = /^[-+=]$/;
export const isAsciiKey = (key: string): boolean => (key.codePointAt(0) ?? 0) < 128;
export const KEY_CODE_SIGNS: Partial<Record<number, string>> = {
  187: '=',
  61: '=',
  171: '=',
  189: '-',
  173: '-',
};
export const isCommandHeld = ({ ctrlKey, altKey, metaKey }: Pick<ModifierFields, 'ctrlKey' | 'altKey' | 'metaKey'>): boolean => metaKey || (ctrlKey && !altKey);
export const isTypingKey = (
  event: Pick<KeyEventFields, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'getModifierState'>,
  allowsAlt: boolean,
): boolean =>
  event.key.length === 1 && !isCommandHeld(event) && (allowsAlt || !event.altKey || event.getModifierState('AltGraph'));
export const isAltCommandPress = ({ key, isModifierHeld, isAltHeld }: KeyPress, isMac: boolean): boolean =>
  isMac && isModifierHeld && isAltHeld && isAltCommandKey(key);
export const isZoomKey = ({ key, code, altKey }: Pick<KeyWithModifiers, 'key' | 'code' | 'altKey'>): boolean =>
  !altKey && (/^[-+=_0]$/.test(key) || (/^(?:Minus|Equal|Digit0)$/.test(code) && !isAsciiKey(key)));
