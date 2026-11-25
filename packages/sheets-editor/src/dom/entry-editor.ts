import type { EntryLooks } from '../state/initial-state.ts';

/** What the last input did with the signs typed into an entry: read them as looks, or put them back as text. */
export type SignsInLastInput = 'read' | 'putBack' | null;

/** An entry's rich-text editor, dressed with the members of a text area. */
export interface EntryEditorElement extends HTMLElement {
  value: string;
  readonly looks: EntryLooks;
  selectionStart: number;
  selectionEnd: number;
  readonly selectionDirection: 'forward' | 'backward' | 'none';
  setSelectionRange(start: number | null, end: number | null, direction?: 'forward' | 'backward' | 'none'): void;
  select(): void;
  replaceText(from: number, to: number, text: string): void;
  readSigns(from: number, to: number, isMarked?: boolean): void;
  readonly signsInLastInput: SignsInLastInput;
  bringCaretIntoSight(): void;
  offsetAtPoint(point: { x: number; y: number }): number | null;
}

export const entryEditorElements = new WeakSet<object>();
export const registerEntryEditor = (element: EntryEditorElement): void => void entryEditorElements.add(element);
export const isEntryEditor = (target: EventTarget | null): target is EntryEditorElement =>
  typeof target === 'object' && target !== null && entryEditorElements.has(target);
export const ENTRY_EDITOR_ATTRIBUTE = 'data-is-entry-editor';
export const ENTRY_EDITOR_OR_INPUT_SELECTOR = 'input,textarea,[data-is-entry-editor]';
export const isTextInputOrEntryEditor = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement | EntryEditorElement =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || isEntryEditor(target);
/** The entry editor the target is in, or the target itself. */
export const entryEditorOf = (target: EventTarget | null): EventTarget | null =>
  target instanceof Element ? (target.closest('[data-is-entry-editor]') ?? target) : target;
