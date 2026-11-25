import * as ProsemirrorModel from 'prosemirror-model';
import * as ProsemirrorState from 'prosemirror-state';
import * as ProsemirrorView from 'prosemirror-view';
import * as ProsemirrorHistory from 'prosemirror-history';
import * as ProsemirrorKeymap from 'prosemirror-keymap';
import * as ProsemirrorCommands from 'prosemirror-commands';
import type { Mark, Node as ProsemirrorNode, Slice } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { Decoration, DecorationSet, EditorView } from 'prosemirror-view';
import type { ListLine } from '@open-artifact/sheets-core';
import { FONT_MARKS, looksFromLines, NO_LIST, isSameList, listsAfterTyping, diffTexts, lineRangeOf } from './text-looks.ts';
import type { LineOfLooks, Look } from './text-looks.ts';
import { typedMarkAtCaret, readTypedMarks } from './entry-looks.ts';
import type { TypedMark } from './entry-looks.ts';
import type { HuedReference } from './formula-bar-hues.tsx';
import { levelInList } from '../model/cell-values.ts';
import { listNumberAttributes, CHECKBOX_LIST_SELECTOR, isPressOnListCheckbox, listOfElement, listAttributesOf } from '../ui/cell-list-attributes.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { normalizeLineBreaks } from '../format/shown-text.ts';
import { registerEntryEditor, isEntryEditor } from '../dom/entry-editor.ts';
import type { EntryEditorElement, SignsInLastInput } from '../dom/entry-editor.ts';
import { referenceTintStyle } from '../grid/cell-drawing.tsx';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import type { EntryLooks, FontMark, StretchOfLooks } from '../state/initial-state.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
/** How signs typed into an entry are read as looks: just as typed, or across the whole text asked for. */
export type HowSignsRead = 'typed' | 'whole';
/** The signs last read in the entry, and whether an undo has since put them back as text. */
export interface SignsRead {
  what: 'read' | 'putBack';
  how: HowSignsRead;
}
/** The number shown before each line of the entry, or null for a line that shows none. */
export type NumbersOfListLines = readonly (number | null)[];
export type SelectionDirection = EntryEditorElement['selectionDirection'];
/** An entry's ProseMirror view, with what it takes to end it and to read the signs typed into it. */
export interface EntryEditorView {
  view: EditorView;
  end: () => void;
  readSigns: (makeTr: (state: EditorState) => Transaction | null, how: HowSignsRead) => void;
  signsInLastInput: () => SignsInLastInput;
}
export let baseBackspace: Command;
export let baseDelete: Command;
export let entryBackspace: Command;
export function lookOfMarks(marks: readonly Mark[]): Look {
  let linkAddress: unknown = marks.find(({ type }) => type.name === 'link')?.attrs.address;
  return {
    marks: FONT_MARKS.filter((fontMark) => marks.some(({ type }) => type.name === fontMark)),
    link: typeof linkAddress === 'string' ? linkAddress : null,
  };
}
export function looksOfEntryDoc(doc: ProsemirrorNode): EntryLooks {
  let lines: LineOfLooks[] = [];
  doc.forEach((paragraph) => {
    let stretches: StretchOfLooks[] = [];
    paragraph.forEach(
      ({ nodeSize, marks }) =>
        stretches.push({
          length: nodeSize,
          ...lookOfMarks(marks),
        }),
    );
    lines.push({
      list: listOfParagraph(paragraph),
      stretches,
    });
  });
  return looksFromLines(lines, []);
}
export function setListsOfEntryLines(tr: Transaction, lists: readonly ListLine[]): void {
  tr.doc.forEach((node, pos, index) => {
    let list = lists[index] ?? NO_LIST;
    if (!isSameList(listOfParagraph(node), list)) tr.setNodeAttribute(pos, 'list', list);
  });
}
export function docPosOfTextOffset(doc: ProsemirrorNode, offset: number): number {
  let remaining = Math.max(0, offset);
  let pos = 0;
  for (let index = 0; index < doc.childCount; index += 1) {
    let { content, nodeSize } = doc.child(index);
    if (remaining <= content.size) return pos + 1 + remaining;
    remaining -= content.size + 1;
    pos += nodeSize;
  }
  return doc.content.size - 1;
}
export function textOffsetOfDocPos(doc: ProsemirrorNode, pos: number): number {
  let resolved = doc.resolve(Math.min(Math.max(pos, 0), doc.content.size));
  let offset = 0;
  for (let index = 0; index < resolved.index(0); index += 1) offset += doc.child(index).content.size + 1;
  if (resolved.depth === 0) return Math.max(0, offset - 1);
  return offset + resolved.parentOffset;
}
export function replaceEntryText(state: EditorState, from: number, to: number, text: string): Transaction {
  let { doc } = state;
  let marks = state.storedMarks ?? doc.resolve(docPosOfTextOffset(doc, from)).marks();
  let slice = new ProsemirrorModel.Slice(
    ProsemirrorModel.Fragment.from(
      text
        .split(
          `
`,
        )
        .map((line) => entryParagraphOf(line, marks)),
    ),
    1,
    1,
  );
  let tr = state.tr.replace(docPosOfTextOffset(doc, from), docPosOfTextOffset(doc, to), text === '' ? ProsemirrorModel.Slice.empty : slice);
  setListsOfEntryLines(
    tr,
    listsAfterTyping(looksOfEntryDoc(doc).lists, textOfEntryDoc(doc), {
      from,
      to,
      written: text,
    }),
  );
  let caret = docPosOfTextOffset(tr.doc, from + text.length);
  return tr.setSelection(ProsemirrorState.TextSelection.create(tr.doc, caret));
}
export function moveEntryText(state: EditorState, from: number, to: number, target: number): Transaction | null {
  if (target >= from && target <= to) return null;
  let { doc, tr } = state;
  let [fromPos, toPos] = [docPosOfTextOffset(doc, from), docPosOfTextOffset(doc, to)];
  let slice = doc.slice(fromPos, toPos);
  tr.delete(fromPos, toPos);
  let targetPos = tr.mapping.map(docPosOfTextOffset(doc, target));
  tr.replace(targetPos, targetPos, slice);
  let newFrom = target < from ? target : target - (to - from);
  return tr.setSelection(
    ProsemirrorState.TextSelection.create(tr.doc, docPosOfTextOffset(tr.doc, newFrom), docPosOfTextOffset(tr.doc, newFrom + (to - from))),
  );
}
export function selectLastWordAtLineEnd(state: EditorState, clickPos: number): Transaction | null {
  let { $from: selectionFrom, $to: selectionTo, empty: isSelectionEmpty } = state.selection;
  let {
    parent: paragraph,
    parentOffset: offsetInParagraph,
    pos: lineEndPos,
  } = isSelectionEmpty ? selectionTo : state.doc.resolve(clickPos);
  let isAtLineEnd = paragraph.isTextblock && offsetInParagraph > 0 && offsetInParagraph === paragraph.content.size;
  let isLineSelected =
    selectionFrom.pos === lineEndPos - offsetInParagraph && (selectionTo.pos === lineEndPos || selectionTo.pos === lineEndPos + 2);
  if (!isAtLineEnd || !(isSelectionEmpty || isLineSelected) || typeof Intl.Segmenter !== 'function') return null;
  let words = [
    ...new Intl.Segmenter(undefined, {
      granularity: 'word',
    }).segment(paragraph.textContent),
  ];
  let lastWordPos = lineEndPos - (words.at(-1)?.segment.length ?? 0);
  return state.tr.setSelection(ProsemirrorState.TextSelection.create(state.doc, lastWordPos, lineEndPos));
}
export function setEntryValue(state: EditorState, newText: string): Transaction | null {
  let oldText = textOfEntryDoc(state.doc);
  if (oldText === newText) return null;
  let { from, to, written } = diffTexts(oldText, newText);
  return replaceEntryText(state, from, to, written);
}
export function applyLooksToEntry(state: EditorState, looks: EntryLooks): Transaction | null {
  let { doc, tr } = state;
  let offset = 0;
  for (let stretch of looks.stretches) {
    let [fromPos, toPos] = [docPosOfTextOffset(doc, offset), docPosOfTextOffset(doc, offset + stretch.length)];
    tr.removeMark(fromPos, toPos);
    for (let mark of marksOfLook(stretch)) tr.addMark(fromPos, toPos, mark);
    offset += stretch.length;
  }
  setListsOfEntryLines(tr, looks.lists);
  return tr.doc.eq(doc) && state.storedMarks === null ? null : tr.setStoredMarks(null);
}
export function withTypedMarkApplied(tr: Transaction, { from, wordsFrom, wordsTo, to, mark }: TypedMark): Transaction {
  let { doc } = tr;
  let fromPos = docPosOfTextOffset(doc, from);
  return tr
    .delete(docPosOfTextOffset(doc, wordsTo), docPosOfTextOffset(doc, to))
    .delete(fromPos, docPosOfTextOffset(doc, wordsFrom))
    .addMark(fromPos, fromPos + wordsTo - wordsFrom, entrySchema.mark(mark))
    .setStoredMarks(null);
}
export function trOfTypedMarkAt(state: EditorState, caret: number, textBefore: string = ''): Transaction | null {
  let text = textOfEntryDoc(state.doc);
  let typedMark = typedMarkAtCaret(text, caret);
  if (typedMark === null) return null;
  let { from, written } = diffTexts(textBefore, text);
  return from <= typedMark.from && typedMark.to <= from + written.length ? withTypedMarkApplied(state.tr, typedMark) : null;
}
export function trOfTypedMarkAtCaret(state: EditorState, textBefore: string, isExact: boolean): Transaction | null {
  if (!state.selection.empty) return null;
  let caret = textOffsetOfDocPos(state.doc, state.selection.head);
  let tr = trOfTypedMarkAt(state, caret, textBefore);
  return tr !== null || isExact ? tr : trOfTypedMarkAt(state, caret - 1, textBefore);
}
export function entrySliceWithLooks(text: string, looks: EntryLooks, from: number, to: number): Slice {
  let lines: ProsemirrorNode[][] = [[]];
  let offset = 0;
  for (let stretch of looks.stretches) {
    let [start, end] = [Math.max(offset, from), Math.min(offset + stretch.length, to)];
    offset += stretch.length;
    if (end <= start) continue;
    for (let [index, line] of text
      .slice(start, end)
      .split(
        `
`,
      )
      .entries()) {
      if (index > 0) lines.push([]);
      if (line !== '') lines.at(-1)?.push(entrySchema.text(line, marksOfLook(stretch)));
    }
  }
  let [firstLine] = lineRangeOf(text, from, to);
  let paragraphs = lines.map(
    (nodes, index) =>
      entrySchema.node(
        'paragraph',
        {
          list: looks.lists[firstLine + index] ?? NO_LIST,
        },
        nodes,
      ),
  );
  return new ProsemirrorModel.Slice(ProsemirrorModel.Fragment.from(paragraphs), 1, 1);
}
export function trWithMarkSignsRead(state: EditorState, from: number, to: number, isMarked: boolean = true): Transaction | null {
  let { doc } = state;
  let [text, looks] = [textOfEntryDoc(doc), looksOfEntryDoc(doc)];
  let read = readTypedMarks(text, looks, from, to, isMarked);
  if (read === null) return null;
  let tr = state.tr.replace(
    docPosOfTextOffset(doc, from),
    docPosOfTextOffset(doc, to),
    entrySliceWithLooks(read.text, read.looks, from, read.to),
  );
  return tr.setSelection(ProsemirrorState.TextSelection.create(tr.doc, docPosOfTextOffset(tr.doc, read.to))).setStoredMarks(null);
}
export function listNumberDecorations(doc: ProsemirrorNode, numbers: NumbersOfListLines): Decoration[] {
  let decorations: Decoration[] = [];
  doc.forEach((node, pos, index) => {
    let [number, level] = [numbers[index] ?? null, levelInList(listOfParagraph(node))];
    if (number !== null && level !== null)
      decorations.push(ProsemirrorView.Decoration.node(pos, pos + node.nodeSize, listNumberAttributes(level, number)));
  });
  return decorations;
}
export function dispatchAsInput(view: EditorView, tr: Transaction, inputType: string): void {
  view.dispatch(ProsemirrorHistory.closeHistory(tr).setMeta(INPUT_TYPE_META, inputType));
  if (!view.isDestroyed) view.dispatch(ProsemirrorHistory.closeHistory(view.state.tr));
}
export function prosemirrorViewInternal(view: EditorView, member: string): Record<PropertyKey, unknown> {
  let internal: unknown = Reflect.get(view, member);
  if (!isNonNullObject(internal)) throw Error(`this ProseMirror’s view has no ${member}`);
  return internal;
}
export function callDomObserver(view: EditorView, methodName: string): void {
  let observer = prosemirrorViewInternal(view, 'domObserver');
  let method = observer[methodName];
  if (typeof method !== 'function') throw Error(`this ProseMirror’s observer has no ${methodName}()`);
  Reflect.apply(method, observer, []);
}
export function runRestartingObserverOnError(view: EditorView, run: () => void): void {
  try {
    run();
  } catch (error) {
    throw (callDomObserver(view, 'start'), error);
  }
}
export function scrollCaretIntoEntry(view: EditorView): boolean {
  let dom = view.dom;
  let caretBox = view.coordsAtPos(view.state.selection.head);
  let bounds = dom.getBoundingClientRect();
  let scale = dom.offsetWidth === 0 ? 1 : bounds.width / dom.offsetWidth;
  let [innerLeft, innerTop] = [bounds.left + dom.clientLeft * scale, bounds.top + dom.clientTop * scale];
  let [innerRight, innerBottom] = [innerLeft + dom.clientWidth * scale, innerTop + dom.clientHeight * scale];
  let scrollToShow = (overBefore: number, overAfter: number) => (overBefore < 0 ? overBefore : Math.max(0, overAfter)) / scale;
  dom.scrollLeft += scrollToShow(caretBox.left - innerLeft, caretBox.right - innerRight);
  dom.scrollTop += scrollToShow(caretBox.top - innerTop, caretBox.bottom - innerBottom);
  return true;
}
export function copyEntryAsPlainText(view: EditorView, event: ClipboardEvent): boolean {
  let { from, to, empty } = view.state.selection;
  if (empty || event.clipboardData === null) return false;
  event.preventDefault();
  event.clipboardData.setData(
    'text/plain',
    view.state.doc.textBetween(
      from,
      to,
      `
`,
    ),
  );
  if (event.type === 'cut') dispatchAsInput(view, view.state.tr.deleteSelection().scrollIntoView(), 'deleteByCut');
  return true;
}
export function dropIntoEntry(view: EditorView, event: DragEvent, isMove: boolean): boolean {
  let dropAt = view.posAtCoords({
    left: event.clientX,
    top: event.clientY,
  });
  let droppedText = normalizeLineBreaks(event.dataTransfer?.getData('text/plain') ?? '');
  event.preventDefault();
  if (dropAt === null) return true;
  let { doc, selection } = view.state;
  let dropOffset = textOffsetOfDocPos(doc, dropAt.pos);
  let tr = isMove
    ? moveEntryText(view.state, textOffsetOfDocPos(doc, selection.from), textOffsetOfDocPos(doc, selection.to), dropOffset)
    : replaceEntryText(view.state, dropOffset, dropOffset, droppedText);
  if (tr === null || (!isMove && droppedText === '')) return true;
  dispatchAsInput(view, tr, 'insertFromDrop');
  if (!view.isDestroyed) view.focus();
  return true;
}
export function dressEntryAsTextArea(element: HTMLElement, { view, readSigns, signsInLastInput }: EntryEditorView): EntryEditorElement {
  let caretOffsets = () => {
    flushEntryDomObserver(view);
    let { doc, selection } = view.state;
    return {
      anchor: textOffsetOfDocPos(doc, selection.anchor),
      head: textOffsetOfDocPos(doc, selection.head),
    };
  };
  let [startOfSelection, endOfSelection] = [
    () => Math.min(...Object.values(caretOffsets())),
    () => Math.max(...Object.values(caretOffsets())),
  ];
  let selectOffsets = (from: number, to: number, direction?: SelectionDirection) => {
    if (view.isDestroyed) return;
    flushEntryDomObserver(view);
    let { doc, tr } = view.state;
    let [fromPos, toPos] = [docPosOfTextOffset(doc, from), docPosOfTextOffset(doc, to)];
    let [anchorPos, headPos] = direction === 'backward' ? [toPos, fromPos] : [fromPos, toPos];
    view.dispatch(tr.setSelection(ProsemirrorState.TextSelection.create(doc, anchorPos, headPos)));
  };
  Object.defineProperties(
    element,
    Object.fromEntries(
      Object.entries({
        value: {
          get: () => (flushEntryDomObserver(view), textOfEntryDoc(view.state.doc)),
          set: (text: string) => {
            let tr = view.isDestroyed ? null : setEntryValue(view.state, text);
            if (tr === null) return;
            view.dispatch(tr.setSelection(ProsemirrorState.TextSelection.atEnd(tr.doc)).setMeta(WRITTEN_INTO_VALUE_META, true));
            view.updateState(withEntryHistoryCleared(view.state));
          },
        },
        looks: {
          get: () => (flushEntryDomObserver(view), looksOfEntryDoc(view.state.doc)),
        },
        selectionStart: {
          get: startOfSelection,
          set: (start: number) => selectOffsets(start, Math.max(start, endOfSelection())),
        },
        selectionEnd: {
          get: endOfSelection,
          set: (end: number) => selectOffsets(Math.min(startOfSelection(), end), end),
        },
        selectionDirection: {
          get: (): SelectionDirection => {
            let { anchor, head } = caretOffsets();
            if (anchor === head) return 'none';
            return anchor < head ? 'forward' : 'backward';
          },
        },
        setSelectionRange: {
          value: (start: number | null, end: number | null, direction?: SelectionDirection) => selectOffsets(start ?? 0, end ?? 0, direction),
        },
        select: {
          value: () => selectOffsets(0, Number.POSITIVE_INFINITY),
        },
        replaceText: {
          value: (from: number, to: number, text: string) => {
            if (view.isDestroyed) return;
            flushEntryDomObserver(view);
            dispatchAsInput(view, replaceEntryText(view.state, from, to, text).scrollIntoView(), 'insertText');
          },
        },
        readSigns: {
          value: (from: number, to: number, isMarked?: boolean) =>
            readSigns((state) => trWithMarkSignsRead(state, from, to, isMarked), 'whole'),
        },
        signsInLastInput: {
          get: signsInLastInput,
        },
        bringCaretIntoSight: {
          value: () => {
            if (!view.isDestroyed) scrollCaretIntoEntry(view);
          },
        },
        offsetAtPoint: {
          value: ({ x, y }: { x: number; y: number }) => {
            let pointAt = view.isDestroyed
              ? null
              : view.posAtCoords({
                  left: x,
                  top: y,
                });
            return pointAt === null ? null : textOffsetOfDocPos(view.state.doc, pointAt.pos);
          },
        },
        focus: {
          value: (focusOptions?: FocusOptions) => {
            if (entryViewsBeingFocused.has(view) || view.isDestroyed)
              return element.ownerDocument.defaultView?.HTMLElement.prototype.focus.call(element, focusOptions);
            if (element === element.ownerDocument.activeElement) return;
            entryViewsBeingFocused.add(view);
            try {
              runRestartingObserverOnError(view, () => view.focus());
            } finally {
              entryViewsBeingFocused.delete(view);
            }
            return;
          },
        },
      }).map(
        ([name, descriptor]): [string, PropertyDescriptor] => [
          name,
          {
            configurable: true,
            ...descriptor,
          },
        ],
      ),
    ),
  );
  // The members of a text area were defined on the element just above.
  registerEntryEditor(element as EntryEditorElement);
  if (!isEntryEditor(element)) throw Error('the entry’s editor was not noted');
  return element;
}
export function dispatchEntryLooks(view: EditorView, looks: EntryLooks, addToHistory: boolean): void {
  let tr = applyLooksToEntry(view.state, looks)?.setMeta(WRITTEN_INTO_VALUE_META, true);
  if (tr === undefined) return;
  if (!addToHistory) return view.dispatch(tr.setMeta('addToHistory', false));
  view.dispatch(ProsemirrorHistory.closeHistory(tr));
  return view.dispatch(ProsemirrorHistory.closeHistory(view.state.tr));
}
export function createEntryEditorView(
  mount: HTMLElement,
  text: string,
  onMarkAsked: (mark: FontMark) => void,
  beforeSignsRead: () => void,
  onBoxOfLinePressed: (line: number) => void,
): EntryEditorView {
  let lastSigns: SignsRead | null = null;
  let wereSignsRead = false;
  let signsInLastInput: SignsInLastInput = null;
  let isInputPending = false;
  let doubleClickPos: number | null = null;
  let doc = entryDocOfText(text);
  let view: EditorView = new ProsemirrorView.EditorView(
    {
      mount,
    },
    {
      state: ProsemirrorState.EditorState.create({
        doc,
        selection: ProsemirrorState.TextSelection.atEnd(doc),
        plugins: [
          entryHistoryPlugin,
          ProsemirrorKeymap.keymap({
            ...ENTRY_DELETE_KEYMAP,
            ...ENTRY_HISTORY_KEYMAP,
            Backspace: (...args: Parameters<Command>) =>
              (lastSigns?.what === 'read' && lastSigns.how === 'typed' && undoInEntry(...args)) || entryBackspace?.(...args) === true,
          }),
          createDecorationsPlugin(referenceHuesKey),
          listNumbersPlugin,
          createSelectionHeldPlugin(),
        ],
      }),
      dispatchTransaction(tr: Transaction) {
        if (tr.docChanged || !tr.selection.eq(view.state.selection)) {
          let readsSigns: unknown = tr.getMeta(READS_SIGNS_META);
          let inputType: unknown = tr.getMeta(INPUT_TYPE_META);
          if (readsSigns === 'typed' || readsSigns === 'whole') wereSignsRead = true;
          if (readsSigns === 'typed' || readsSigns === 'whole')
            lastSigns = {
              what: 'read',
              how: readsSigns,
            };
          else if (lastSigns?.what === 'read' && inputType === 'historyUndo')
            lastSigns = {
              what: 'putBack',
              how: lastSigns.how,
            };
          else if (lastSigns?.what === 'putBack' && inputType === 'historyRedo')
            lastSigns = {
              what: 'read',
              how: lastSigns.how,
            };
          else lastSigns = null;
        }
        let isUndoAfterRead = wereSignsRead && tr.getMeta(INPUT_TYPE_META) === 'historyUndo';
        if (tr.docChanged) signsInLastInput = lastSigns?.what ?? (isUndoAfterRead ? 'putBack' : null);
        view.updateState(view.state.apply(tr));
        if (!tr.docChanged || tr.getMeta(WRITTEN_INTO_VALUE_META) === true) return;
        let inputTypeOfTr: unknown = tr.getMeta(INPUT_TYPE_META);
        if (typeof inputTypeOfTr !== 'string' && isInputPending) return;
        let { InputEvent: InputEventOfView }: Partial<Pick<Window & typeof globalThis, 'InputEvent'>> = mount.ownerDocument.defaultView ?? {};
        if (InputEventOfView !== undefined)
          mount.dispatchEvent(
            new InputEventOfView('input', {
              bubbles: true,
              inputType: typeof inputTypeOfTr === 'string' ? inputTypeOfTr : '',
            }),
          );
      },
      handleDOMEvents: {
        focus: (viewFocused) => entryViewsBeingFocused.has(viewFocused),
        paste: (_view, event) => event.defaultPrevented,
        copy: copyEntryAsPlainText,
        cut: copyEntryAsPlainText,
        mousedown: (_view, event) => {
          doubleClickPos = null;
          let paragraph = event.target instanceof Element ? event.target.closest('p') : null;
          if (!(event.button === 0 && paragraph?.matches(CHECKBOX_LIST_SELECTOR) === true && isPressOnListCheckbox(paragraph, event))) return false;
          event.preventDefault();
          onBoxOfLinePressed([...mount.children].indexOf(paragraph));
          return true;
        },
        dblclick: (_view, { button, shiftKey, clientX, clientY }) => {
          flushEntryDomObserver(view);
          let tr =
            button === 0 &&
            !shiftKey &&
            view.posAtCoords({
              left: clientX,
              top: clientY,
            })?.pos === doubleClickPos &&
            doubleClickPos !== null
              ? selectLastWordAtLineEnd(view.state, doubleClickPos)
              : null;
          if (tr !== null) view.dispatch(tr);
          return false;
        },
        beforeinput: (_view, event) => {
          if (event.inputType.startsWith('format')) event.preventDefault();
          let mark = FORMAT_INPUT_MARKS[event.inputType];
          if (mark !== undefined) onMarkAsked(mark);
          if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
            event.preventDefault();
            (event.inputType === 'historyUndo' ? undoInEntry : redoInEntry)(view.state, view.dispatch, view);
          }
          return true;
        },
      },
      handleKeyPress: (_view, event) => {
        let typed = String.fromCharCode(event.charCode);
        if (isSelectionInOneParagraph(view.state) || !event.isTrusted || /[\r\n]/.test(typed)) return false;
        view.dispatch(view.state.tr.insertText(typed).scrollIntoView().setMeta(INPUT_TYPE_META, 'insertText'));
        return true;
      },
      handleDoubleClick: (_view, pos) => ((doubleClickPos = pos), false),
      handleDrop: (_view, event, _slice, isMove) => dropIntoEntry(view, event, isMove),
      handleScrollToSelection: scrollCaretIntoEntry,
      transformPastedHTML: () => '',
      clipboardTextSerializer: ({ content }) =>
        content.textBetween(
          0,
          content.size,
          `
`,
        ),
    },
  );
  guardEntryUpdateState(view);
  let controller = new AbortController();
  let listen = <Type extends keyof HTMLElementEventMap>(
    type: Type,
    listener: (event: HTMLElementEventMap[Type]) => void,
    isCapture: boolean = false,
  ) =>
    mount.addEventListener(type, listener, {
      capture: isCapture,
      signal: controller.signal,
    });
  listen('beforeinput', (event) => {
    isInputPending = !event.defaultPrevented;
  });
  listen('input', () => {
    flushEntryDomObserver(view);
    isInputPending = false;
  });
  for (let type of ['keydown', 'drop'] satisfies (keyof HTMLElementEventMap)[]) listen(type, () => void (isInputPending = false), true);
  listen('dragstart', ({ dataTransfer }) => dataTransfer?.clearData('text/html'));
  return {
    view,
    end: () => {
      controller.abort();
      view.destroy();
    },
    readSigns: (makeTr, how) => {
      if (view.isDestroyed || view.composing) return;
      flushEntryDomObserver(view);
      if (makeTr(view.state) === null) return;
      beforeSignsRead();
      let tr = makeTr(view.state);
      if (tr !== null) dispatchAsInput(view, tr.setMeta(READS_SIGNS_META, how).scrollIntoView(), 'insertReplacementText');
    },
    signsInLastInput: () => signsInLastInput,
  };
}
export const LINK_ADDRESS_ATTRIBUTE = 'data-links-to';
export const isListObject = (value: unknown): boolean => typeof value === 'object' && value !== null && 'kind' in value;
/** The list a paragraph is a line of; the schema and every write of the attribute keep it a list line. */
export const listOfParagraph = ({ attrs }: ProsemirrorNode): ListLine => (isListObject(attrs.list) ? attrs.list : NO_LIST);
export const isListParagraph = (node: ProsemirrorNode): boolean => listOfParagraph(node).kind !== 'none';
export const entrySchema = new ProsemirrorModel.Schema({
  nodes: {
    doc: {
      content: 'paragraph+',
    },
    paragraph: {
      content: 'text*',
      attrs: {
        list: {
          default: NO_LIST,
        },
      },
      selectable: false,
      parseDOM: [
        {
          tag: 'p',
          getAttrs: (element) => ({
            list: listOfElement(element),
          }),
        },
        {
          tag: 'div',
        },
      ],
      toDOM: (node) => [
        'p',
        listAttributesOf({
          list: listOfParagraph(node),
          number: null,
        }),
        0,
      ],
    },
    text: {
      toDebugString: () => 'text',
    },
  },
  marks: {
    bold: {
      parseDOM: [
        {
          tag: 'strong',
        },
      ],
      toDOM: () => ['strong', 0],
    },
    italic: {
      parseDOM: [
        {
          tag: 'em',
        },
      ],
      toDOM: () => ['em', 0],
    },
    underline: {
      parseDOM: [
        {
          tag: 'u',
        },
      ],
      toDOM: () => ['u', 0],
    },
    strikethrough: {
      parseDOM: [
        {
          tag: 's',
        },
      ],
      toDOM: () => ['s', 0],
    },
    link: {
      attrs: {
        address: {
          validate: 'string',
        },
      },
      inclusive: false,
      parseDOM: [
        {
          tag: `span[${LINK_ADDRESS_ATTRIBUTE}]`,
          getAttrs: (element) => ({
            address: element.getAttribute(LINK_ADDRESS_ATTRIBUTE),
          }),
        },
      ],
      toDOM: ({ attrs }) => [
        'span',
        {
          [LINK_ADDRESS_ATTRIBUTE]: String(attrs.address),
        },
        0,
      ],
    },
  },
});
export const marksOfLook = ({ marks, link }: Look): Mark[] => [
  ...marks.map((mark) => entrySchema.mark(mark)),
  ...(link === null
    ? []
    : [
        entrySchema.mark('link', {
          address: link,
        }),
      ]),
];
export const entryParagraphOf = (text: string, marks: readonly Mark[] = []): ProsemirrorNode =>
  entrySchema.node('paragraph', null, text === '' ? [] : [entrySchema.text(text, marks)]);
export const entryDocOfText = (text: string): ProsemirrorNode =>
  entrySchema.node(
    'doc',
    null,
    text
      .split(
        `
`,
      )
      .map((line) => entryParagraphOf(line)),
  );
export const textOfEntryDoc = (doc: ProsemirrorNode): string =>
  doc.textBetween(
    0,
    doc.content.size,
    `
`,
  );
export const entryHistoryPlugin = ProsemirrorHistory.history({
  newGroupDelay: -1,
  depth: 1000,
});
export const withEntryHistoryCleared = (state: EditorState): EditorState =>
  state
    .reconfigure({
      plugins: state.plugins.filter((plugin) => plugin !== entryHistoryPlugin),
    })
    .reconfigure({
      plugins: state.plugins,
    });
export const selectionHeldDecorations = (doc: ProsemirrorNode, span: CaretSpan | undefined): DecorationSet =>
  span === undefined
    ? ProsemirrorView.DecorationSet.empty
    : ProsemirrorView.DecorationSet.create(doc, [
        ProsemirrorView.Decoration.inline(docPosOfTextOffset(doc, span.start), docPosOfTextOffset(doc, span.end), {
          class: 'sheet-selection-held',
        }),
      ]);
export const referenceHueDecorations = (doc: ProsemirrorNode, references: readonly HuedReference[]): DecorationSet =>
  ProsemirrorView.DecorationSet.create(
    doc,
    references.flatMap(
      ({ writtenAt, hue }) =>
        writtenAt === undefined
          ? []
          : [
              ProsemirrorView.Decoration.inline(docPosOfTextOffset(doc, writtenAt.start), docPosOfTextOffset(doc, writtenAt.end), {
                class: 'sheet-reference-in-entry',
                style: Object.entries(referenceTintStyle(hue))
                  .map(([property, propertyValue]) => `${property}:${propertyValue}`)
                  .join(';'),
              }),
            ],
    ),
  );
export const INPUT_TYPE_META = 'inputTypeOfEntryEditor';
export const READS_SIGNS_META = 'readsSignsInEntryEditor';
export const WRITTEN_INTO_VALUE_META = 'isWrittenIntoValueOfEntryEditor';
export const withInputTypeMeta =
  (inputType: string, command: Command): Command =>
  (state, dispatch, view) =>
    command(state, dispatch === undefined ? undefined : (tr) => dispatch(tr.setMeta(INPUT_TYPE_META, inputType)), view);
export const undoInEntry = withInputTypeMeta('historyUndo', ProsemirrorHistory.undo);
export const redoInEntry = withInputTypeMeta('historyRedo', ProsemirrorHistory.redo);
export const asInputCommand =
  (inputType: string, command: Command): Command =>
  (state, dispatch, view) =>
    command(state, dispatch === undefined || view === undefined ? undefined : (tr) => dispatchAsInput(view, tr, inputType), view);
export const isSelectionInOneParagraph = ({ selection }: EditorState): boolean =>
  selection instanceof ProsemirrorState.TextSelection && selection.$from.sameParent(selection.$to);
export const leaveInParagraphDeletesToBrowser =
  (command: Command): Command =>
  (state, dispatch, view) =>
    (state.selection.empty || !isSelectionInOneParagraph(state)) && command(state, dispatch, view);
({ Backspace: baseBackspace, Delete: baseDelete } = ProsemirrorCommands.baseKeymap);
export const keepsListOnBackspaceAtStart =
  (command: Command): Command =>
  (state, dispatch, view) => {
    let { empty, $from: selectionFrom } = state.selection;
    let isAtListStart = empty && selectionFrom.parentOffset === 0 && isListParagraph(selectionFrom.parent);
    let areLooksSeen = view?.dom.hasAttribute('data-keeps-looks-unseen') !== true;
    return !(isAtListStart && areLooksSeen) && command(state, dispatch, view);
  };
export const ENTRY_DELETE_KEYMAP = Object.fromEntries(
  Object.entries(ProsemirrorCommands.baseKeymap).flatMap(([key, baseCommand]): [string, Command][] => {
    if (baseCommand !== baseBackspace && baseCommand !== baseDelete) return [];
    let command = leaveInParagraphDeletesToBrowser(
      asInputCommand(baseCommand === baseBackspace ? 'deleteContentBackward' : 'deleteContentForward', baseCommand),
    );
    return [[key, key === 'Backspace' ? keepsListOnBackspaceAtStart(command) : command]];
  }),
);
({ Backspace: entryBackspace } = ENTRY_DELETE_KEYMAP);
export const alwaysHandled =
  (command: Command) =>
  (...args: Parameters<Command>): true => (command(...args), true);
export const ENTRY_HISTORY_KEYMAP = {
  'Mod-z': alwaysHandled(undoInEntry),
  'Shift-Mod-z': alwaysHandled(redoInEntry),
  ...(IS_APPLE_PLATFORM
    ? {}
    : {
        'Mod-y': alwaysHandled(redoInEntry),
      }),
};
export const selectionHeldKey = new ProsemirrorState.PluginKey<DecorationSet>('selectionHeld');
export const createSelectionHeldPlugin = () =>
  new ProsemirrorState.Plugin<DecorationSet>({
    key: selectionHeldKey,
    state: {
      init: () => ProsemirrorView.DecorationSet.empty,
      apply: (tr, decorations) => {
        let held: unknown = tr.getMeta(selectionHeldKey);
        return held instanceof ProsemirrorView.DecorationSet ? held : decorations.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => selectionHeldKey.getState(state),
    },
  });
export const referenceHuesKey = new ProsemirrorState.PluginKey<DecorationSet>('huesOnReferences');
export const listNumbersKey = new ProsemirrorState.PluginKey<NumbersOfListLines>('numbersOnLines');
export const NO_LIST_NUMBERS: NumbersOfListLines = [];
/** Whether a meta set on the list numbers' key holds numbers; the entry field sets it only to the numbers of its lines. */
export const isListNumbers = (meta: unknown): meta is NumbersOfListLines => Array.isArray(meta);
export const listNumbersPlugin = new ProsemirrorState.Plugin<NumbersOfListLines>({
  key: listNumbersKey,
  state: {
    init: () => NO_LIST_NUMBERS,
    apply: (tr, numbers) => {
      let numbersMeta: unknown = tr.getMeta(listNumbersKey);
      return isListNumbers(numbersMeta) ? numbersMeta : numbers;
    },
  },
  props: {
    decorations: (state) =>
      ProsemirrorView.DecorationSet.create(state.doc, [...listNumberDecorations(state.doc, listNumbersKey.getState(state) ?? NO_LIST_NUMBERS)]),
  },
});
export const createDecorationsPlugin = (key: ProsemirrorState.PluginKey<DecorationSet>) =>
  new ProsemirrorState.Plugin<DecorationSet>({
    key,
    state: {
      init: () => ProsemirrorView.DecorationSet.empty,
      apply: (tr, decorations) => {
        let decorationsMeta: unknown = tr.getMeta(key);
        return decorationsMeta instanceof ProsemirrorView.DecorationSet ? decorationsMeta : decorations.map(tr.mapping, tr.doc);
      },
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
export const MATCHING_BRACKETS_CLASS = 'sheet-matching-brackets';
export const flushEntryDomObserver = (view: EditorView): void => callDomObserver(view, 'flush');
export const guardEntryUpdateState = (view: EditorView): void =>
  void Object.defineProperty(view, 'updateState', {
    value: (state: EditorState) =>
      runRestartingObserverOnError(view, () => ProsemirrorView.EditorView.prototype.updateState.call(view, state)),
  });
export const entryViewsBeingFocused = new WeakSet<EditorView>();
/** The font mark each formatting input asks for. */
export const FORMAT_INPUT_MARKS: Readonly<Partial<Record<string, FontMark>>> = {
  formatBold: 'bold',
  formatItalic: 'italic',
  formatUnderline: 'underline',
  formatStrikeThrough: 'strikethrough',
};
