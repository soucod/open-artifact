import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { isEntryUntouched } from '../formulas/reference-pointing.ts';
import { diffTexts } from './text-looks.ts';
import { isEntryEditor, entryEditorOf } from '../dom/entry-editor.ts';
import { createPasteKeyTracker } from '../clipboard/paste-keys.ts';
import { normalizeLineBreaks, trimTrailingNewlines, flattenEnteredText } from '../format/shown-text.ts';
import { isOneLineEditor } from '../state/transitions.ts';
import { textWithMarkSignsRead } from './entry-looks.ts';
import { linkOfAddressPastedOverWords } from '../links/links-in-entry.ts';
import type { EntryEditorElement } from '../dom/entry-editor.ts';
import type { EditingMode, PageMode } from '../state/transitions.ts';
import type { SheetController } from '../state/controller.ts';
import type { AddressPastedOverWords, CaretInEntry } from '../state/event-reducer.ts';
import type { KeyAct } from '../keys/key-acts.ts';
import type { PageView } from '../view/page-view.ts';
/** A box an entry is typed in: the cell's editor, or a text field. */
export type EntryBox = HTMLInputElement | HTMLTextAreaElement | EntryEditorElement;
/** The boxes an entry can be typed in: in the cell and in the formula bar. */
export interface EntryBoxes {
  cell: React.RefObject<EntryBox | null>;
  formulaBar: React.RefObject<HTMLTextAreaElement | null>;
}
/** The controller as the entry boxes use it. */
export type EntryBoxStore = Pick<SheetController, 'getView' | 'dispatch' | 'subscribe' | 'mayAnEntryOpenOrEnd'>;
/** A caret kept as its start and end. */
export type CaretEnds = [number | null, number | null];
/** The caret last seen in a box, with the text it was in; no caret when it is to be found again. */
export interface CaretRemembered {
  text: string;
  at: CaretEnds | null;
}
/** The caret in an entry, and whether it was put there by hand rather than left where the page put it. */
export interface CaretInEntryPlaced extends CaretInEntry {
  isPlacedByHand?: true;
}
/** A listener the entry boxes add to their document, with the event it hears. */
type DocumentListener = [type: string, listener: (event: Event) => void];
/** A write of text into an entry box. */
export type WriteInEntry = Extract<KeyAct, { kind: 'writeInEntry' }>;
export let isPastingIntoEntry: boolean;
export function forgetCaretPlacement(box: EntryBox, mode: PageMode): void {
  if (isEntryUntouched(mode))
    caretMemory.set(box, {
      text: box.value,
      at: null,
    });
}
export function isCaretWhereLeft(box: EntryBox, mode: PageMode): boolean {
  let { value: text, selectionStart, selectionEnd } = box;
  let remembered = caretMemory.get(box);
  let defaultCaret: CaretEnds = isEntryUntouched(mode) ? [selectionStart, selectionEnd] : [text.length, text.length];
  let caret = remembered?.text === text ? remembered.at : defaultCaret;
  let isUnmoved = selectionStart === caret?.[0] && selectionEnd === caret[1];
  caretMemory.set(box, {
    text,
    at: isUnmoved ? caret : null,
  });
  return isUnmoved;
}
export function caretInEntryPatch(mode: PageMode, boxes: EntryBoxes): { caretInEntry?: CaretInEntryPlaced } {
  let box = typingBoxOf(mode, boxes);
  let { selectionStart = null, selectionEnd = null }: Partial<Pick<EntryBox, 'selectionStart' | 'selectionEnd'>> = box ?? {};
  if (box === null || selectionStart === null || selectionEnd === null) return {};
  let caret: CaretInEntry = {
    start: selectionStart,
    end: selectionEnd,
    text: box.value,
    isComposing: composingBoxes.has(box),
  };
  return {
    caretInEntry: isCaretWhereLeft(box, mode)
      ? caret
      : {
          ...caret,
          isPlacedByHand: true,
        },
  };
}
export function giveEntryBoxOfItsOwn(store: Omit<EntryBoxStore, 'subscribe'>, { cell }: Pick<EntryBoxes, 'cell'>): void {
  let { mode } = store.getView();
  let cellBox = cell.current;
  if (mode.kind !== 'editing' || mode.isInBoxOfOneLine !== true || cellBox === null) return;
  if (composingBoxes.has(cellBox) || store.mayAnEntryOpenOrEnd()) return;
  let ownerDocument = cellBox.ownerDocument;
  let isFocused = cellBox === ownerDocument.activeElement;
  if (isFocused && !ownerDocument.hasFocus()) return;
  let { selectionStart, selectionEnd } = cellBox;
  ReactDOM.flushSync(
    () =>
      store.dispatch({
        kind: 'entryGivenBoxOfItsOwn',
      }),
  );
  if (isFocused && cell.current !== cellBox) cell.current?.setSelectionRange(selectionStart, selectionEnd);
}
export function giveEntryBoxToFormat(store: Omit<EntryBoxStore, 'subscribe'>, boxes: EntryBoxes): void {
  let { mode } = store.getView();
  let box = typingBoxOf(mode, boxes);
  if (mode.kind !== 'editing' || box === null) return;
  if (doesFormatNeedOwnBox(mode.typingIn, box)) giveEntryBoxOfItsOwn(store, boxes);
}
export function writeIntoBox(box: EntryBox, text: string, caretAt?: number): void {
  let oldText = box.value;
  let { from, to, written } = diffTexts(oldText, text, caretAt);
  if (isEntryEditor(box)) return box.replaceText(from, to, written);
  let scrollFromEnd = box.scrollWidth - box.scrollLeft;
  box.setSelectionRange(from, to);
  box.ownerDocument.execCommand(written === '' ? 'delete' : 'insertText', false, written);
  box.scrollLeft = written.endsWith(`
`)
    ? 0
    : box.scrollWidth - scrollFromEnd;
  if (
    text.endsWith(`
`) &&
    to === oldText.length
  )
    box.scrollTop = box.scrollHeight;
}
export function createWrittenTextLog() {
  let writes = new Set<string>();
  return {
    wrote: (before: string, after: string): void => void writes.add(JSON.stringify([before, after])),
    has: (direction: 'undo' | 'redo', before: string, after: string): boolean =>
      writes.has(JSON.stringify(direction === 'undo' ? [after, before] : [before, after])),
    clear: () => writes.clear(),
  };
}
export function useEntryBoxes(store: EntryBoxStore, { cell, formulaBar }: EntryBoxes): (write: WriteInEntry) => void {
  let [writtenLog] = React.useState(createWrittenTextLog);
  React.useEffect(() => {
    let ownerDocument = formulaBar.current?.ownerDocument;
    let lastPointed: PageView['pointedReference'] = null;
    let typingBox: EntryBox | null = null;
    let unsubscribe = store.subscribe(() => {
      let { pointedReference, mode } = store.getView();
      let box = typingBoxOf(mode, {
        cell,
        formulaBar,
      });
      if (box !== typingBox) writtenLog.clear();
      if (box !== typingBox && typingBox !== null) caretMemory.delete(typingBox);
      if (box === null) {
        for (let { current: boxElement } of [cell, formulaBar]) if (boxElement !== null) caretMemory.delete(boxElement);
      }
      typingBox = box;
      if (pointedReference === lastPointed) return;
      lastPointed = pointedReference;
      if (pointedReference === null || box === null || box !== box.ownerDocument.activeElement) return;
      if (box.value !== pointedReference.text) {
        writtenLog.wrote(box.value, pointedReference.text);
        writeIntoBox(box, pointedReference.text);
      }
      box.setSelectionRange(pointedReference.end, pointedReference.end);
      rememberCaretAtEnd(box);
    });
    let textBeforeInput = '';
    let onBeforeInput = (event: Event) => {
      let { target } = event;
      if (target === typingBox && typingBox !== null) textBeforeInput = typingBox.value;
      if (
        event instanceof InputEvent &&
        (event.inputType === 'insertLineBreak' ||
          event.inputType === 'insertParagraph' ||
          (event.inputType === 'insertText' && event.data === '\r')) &&
        (target === cell.current || target === formulaBar.current)
      )
        event.preventDefault();
    };
    let pasteAddressOverWords = (box: EntryEditorElement | HTMLTextAreaElement, link: Pick<AddressPastedOverWords, 'address' | 'start' | 'end'>) => {
      let { value, selectionEnd } = box;
      store.dispatch({
        kind: 'addressPastedOverWords',
        ...link,
        text: value,
        caretAt: selectionEnd,
      });
      box.setSelectionRange(selectionEnd, selectionEnd);
    };
    let defaultView = ownerDocument?.defaultView ?? null;
    let pasteKeys = defaultView === null ? null : createPasteKeyTracker(defaultView);
    let replaceAndReadSigns = (editor: EntryEditorElement, text: string) => {
      let { selectionStart } = editor;
      editor.replaceText(selectionStart, editor.selectionEnd, text);
      if (store.getView().grid.doesEntryReadSigns)
        editor.readSigns(selectionStart, selectionStart + text.length, pasteKeys?.isWithoutFormatting() !== true);
    };
    let listeners: DocumentListener[] = [
      ['beforeinput', onBeforeInput],
      [
        'paste',
        (event) => {
          let box = entryEditorOf(event.target);
          if (box === null || (box !== cell.current && box !== formulaBar.current)) return;
          if (store.getView().mode.kind !== 'editing' && box === cell.current) return;
          let pastedText = event instanceof ClipboardEvent ? event.clipboardData?.getData('text') : '';
          let text = normalizeLineBreaks(pastedText ?? '');
          let cellBox = cell.current;
          let isCaretAtEnd = box instanceof HTMLTextAreaElement && box.selectionEnd === box.value.length;
          if (
            trimTrailingNewlines(text).includes(`
`) &&
            !composingBoxes.has(box)
          )
            giveEntryBoxOfItsOwn(store, {
              cell,
            });
          let { mode } = store.getView();
          let flatText = mode.kind === 'editing' && isOneLineEditor(mode) ? flattenEnteredText(text) : trimTrailingNewlines(text);
          let barReadingSigns =
            pasteKeys?.isWithoutFormatting() === true && box === formulaBar.current && store.getView().grid.doesEntryReadSigns
              ? formulaBar.current
              : null;
          let textToWrite =
            barReadingSigns === null
              ? flatText
              : textWithMarkSignsRead(
                  barReadingSigns.value.slice(0, barReadingSigns.selectionStart ?? 0),
                  flatText,
                  barReadingSigns.value.slice(barReadingSigns.selectionEnd ?? 0),
                );
          // The listeners are added only to a document that is there.
          let activeElement = ownerDocument?.activeElement as Element | null;
          let isBarActive = activeElement instanceof HTMLTextAreaElement && activeElement === formulaBar.current;
          // isBarActive holds only for the formula bar's text area.
          let activeBox = isEntryEditor(activeElement) || isBarActive ? (activeElement as EntryEditorElement | HTMLTextAreaElement) : null;
          let linkOverWords =
            activeBox !== null &&
            store.getView().doesKeyOpenLinkForm &&
            mode.kind === 'editing' &&
            mode.isInBoxOfOneLine !== true &&
            mode.text === activeBox.value &&
            !store.mayAnEntryOpenOrEnd()
              ? linkOfAddressPastedOverWords(
                  mode.text,
                  {
                    start: activeBox.selectionStart,
                    end: activeBox.selectionEnd,
                  },
                  textToWrite,
                )
              : null;
          if (
            linkOverWords === null &&
            isPasteLeftToBrowser(text, textToWrite, isCaretAtEnd) &&
            cell.current === cellBox &&
            !isEntryEditor(activeElement)
          )
            return;
          event.preventDefault();
          isPastingIntoEntry = true;
          try {
            if (linkOverWords !== null && activeBox !== null) pasteAddressOverWords(activeBox, linkOverWords);
            else if (!isEntryEditor(activeElement)) ownerDocument?.execCommand('insertText', false, textToWrite);
            else if (textToWrite !== '') replaceAndReadSigns(activeElement, textToWrite);
          } finally {
            isPastingIntoEntry = false;
          }
        },
      ],
      [
        'input',
        (event) => {
          let inputType = event instanceof InputEvent ? event.inputType : null;
          for (let { current: boxElement } of [cell, formulaBar])
            if (boxElement !== null && boxElement === event.target) rememberCaretAtEnd(boxElement);
          if (event.target !== typingBox || typingBox === null) return;
          if (inputType !== 'historyUndo' && inputType !== 'historyRedo') return;
          let direction: 'undo' | 'redo' = inputType === 'historyUndo' ? 'undo' : 'redo';
          if (writtenLog.has(direction, textBeforeInput, typingBox.value))
            typingBox.setSelectionRange(typingBox.selectionEnd, typingBox.selectionEnd);
        },
      ],
      [
        'selectionchange',
        () => {
          if (typingBox !== null && typingBox === ownerDocument?.activeElement) isCaretWhereLeft(typingBox, store.getView().mode);
        },
      ],
      [
        'contextmenu',
        ({ target }) => {
          if (entryEditorOf(target) === typingBox && typingBox !== null && isEntryUntouched(store.getView().mode)) caretMemory.delete(typingBox);
        },
      ],
      ['compositionstart', ({ target }) => void (target !== null && composingBoxes.add(entryEditorOf(target) ?? target))],
      ['compositionend', ({ target }) => void (target !== null && composingBoxes.delete(entryEditorOf(target) ?? target))],
    ];
    for (let [type, listener] of listeners) ownerDocument?.addEventListener(type, listener, true);
    return () => {
      unsubscribe();
      pasteKeys?.stop();
      for (let [type, listener] of listeners) ownerDocument?.removeEventListener(type, listener, true);
    };
  }, [store, cell, formulaBar, writtenLog]);
  return React.useCallback(
    ({ text, caretAt, typingIn }: WriteInEntry) => {
      let box = (
        {
          cell,
          formulaBar,
        }
      )[typingIn].current;
      if (box === null || box !== box.ownerDocument.activeElement || box.value === text) return;
      writtenLog.wrote(box.value, text);
      writeIntoBox(box, text, caretAt);
      box.setSelectionRange(caretAt, caretAt);
      rememberCaretAtEnd(box);
    },
    [cell, formulaBar, writtenLog],
  );
}
export const typingBoxOf = (mode: PageMode, boxes: EntryBoxes): EntryBox | null => (mode.kind === 'editing' ? boxes[mode.typingIn].current : null);
export const composingBoxes = new WeakSet<EventTarget>();
isPastingIntoEntry = false;
export const isPastingIntoEntryNow = (): boolean => isPastingIntoEntry;
export const caretMemory = new WeakMap<EntryBox, CaretRemembered>();
export const rememberCaretAtEnd = (box: EntryBox): void =>
  void caretMemory.set(box, {
    text: box.value,
    at: [box.selectionEnd, box.selectionEnd],
  });
export const giveEntryBoxOfItsOwnAlias = giveEntryBoxOfItsOwn;
export const doesFormatNeedOwnBox = (
  typingIn: EditingMode['typingIn'],
  { selectionStart, selectionEnd }: Pick<EntryBox, 'selectionStart' | 'selectionEnd'>,
): boolean =>
  typingIn === 'formulaBar' || selectionStart !== selectionEnd;
export const PASTE_LINES_LEFT_TO_BROWSER = 50;
export const isPasteLeftToBrowser = (pasted: string, text: string, isCaretAtEnd: boolean): boolean =>
  text === pasted ||
  (isCaretAtEnd &&
    text.split(`
`).length >= PASTE_LINES_LEFT_TO_BROWSER);
