import { Spinner } from '../kit/spinner.tsx';
import * as React from 'react';
import * as ProsemirrorHistory from 'prosemirror-history';
import * as ReactDOM from 'react-dom';
import type { EditorView } from 'prosemirror-view';
import {
  withEntryHistoryCleared,
  dispatchEntryLooks,
  setEntryValue,
  WRITTEN_INTO_VALUE_META,
  applyLooksToEntry,
  NO_LIST_NUMBERS,
  createEntryEditorView,
  textOfEntryDoc,
  dressEntryAsTextArea,
  selectionHeldKey,
  selectionHeldDecorations,
  listNumbersKey,
  referenceHuesKey,
  referenceHueDecorations,
  docPosOfTextOffset,
  MATCHING_BRACKETS_CLASS,
  trOfTypedMarkAtCaret,
} from './entry-editor-view.ts';
import type { EntryEditorView, NumbersOfListLines } from './entry-editor-view.ts';
import type { HuedReference } from './formula-bar-hues.tsx';
import { plainLooks, hasLists } from './text-looks.ts';
import { ENTRY_EDITOR_ATTRIBUTE } from '../dom/entry-editor.ts';
import type { EntryEditorElement } from '../dom/entry-editor.ts';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { CHECKBOX_LIST_SELECTOR, isPressOnListCheckbox } from '../ui/cell-list-attributes.ts';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { agentTurnUndoOffer, describeUndoOffer } from '../i18n/change-labels.ts';
import type { UndoOfferWords } from '../i18n/change-labels.ts';
import { DONE_CARD_WAIT_MS } from '../agent/turn-of-agent.ts';
import type { BracketPair, EntryLooks, FontMark, PageState } from '../state/initial-state.ts';
import type { EditingMode } from '../state/transitions.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
import type { Wait } from '../state/calculating-shown.ts';
/** Where to put the caret once the entry holds this text. */
export type CaretToPut = NonNullable<EditingMode['caretToPut']>;
/** A change in the rich entry editor, told the way a text area's change event tells it. */
export interface EntryEditorChange {
  target: EventTarget & HTMLDivElement;
  nativeEvent: InputEvent;
}
/** The editor of an entry once it is made, with what it shows now. */
export interface MountedEntryEditor extends EntryEditorView {
  element: EntryEditorElement;
  referencesShown: readonly HuedReference[] | null;
  heldShown: CaretSpan | undefined;
  looksShown: EntryLooks | undefined;
  hasShownLooks: boolean;
  valueShown: string | null;
  numbersShown: NumbersOfListLines;
  caretPut: CaretToPut | null;
}
export interface RichEntryEditorProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onInput' | 'onCompositionEnd'> {
  ref?: React.Ref<EntryEditorElement>;
  value: string;
  onChange?: (change: EntryEditorChange) => void;
  onInput?: (event: React.InputEvent<HTMLDivElement>) => void;
  onCompositionEnd?: (event: React.CompositionEvent<HTMLDivElement>) => void;
  isGoing?: boolean;
  references: readonly HuedReference[];
  brackets?: BracketPair | null;
  looks?: EntryLooks;
  areLooksSeen?: boolean;
  marksOfCell?: FontMark[];
  areSignsRead?: boolean;
  textHeldAsEntryOpened?: string;
  areSignsLeftAsTyped?: boolean;
  numbersOfLines?: NumbersOfListLines;
  caretToPut?: CaretToPut | null;
  onMarkAsked?: (mark: FontMark) => void;
  selectionHeld?: CaretSpan;
  onBoxPressed?: (line: number) => void;
}
export type TextAreaEntryInputProps = { as: 'textArea' } & React.ComponentProps<'textarea'>;
export type EditorEntryInputProps = { as: 'editor' } & RichEntryEditorProps;
/** The field an entry is typed in: a plain text area, or the rich entry editor. */
export type EntryInputProps = TextAreaEntryInputProps | EditorEntryInputProps;
export interface LingeringEntryInputProps {
  drawn: EntryInputProps | null;
  ofCell?: string | null;
}
/** The field drawn last, kept on the page a little while after it is gone. */
interface LingeringEntry {
  drawn: EntryInputProps | null;
  ofCell: string | null;
  isGoing: boolean;
  nth: number;
}
/** A press on the box of a checkbox line in a cell, until the pointer is let go. */
interface LineBoxPress {
  line: string;
  pointerId: number;
}
export interface CalculatingSpinnerProps {
  isTurning: boolean;
}
/** The offer to undo shown on the card at the foot of the page. */
export interface UndoOfferShown extends UndoOfferWords {
  /** What keeps the card the same while the offer stands: the last revision of the agent's turn, or the move offered. */
  key: string | number;
  taken: 'undoOfTurnTaken' | 'undoOfferTaken';
  wait: Wait;
}
export function showPlainLooksInEntry(view: EditorView, text: string, marksOfCell: FontMark[]): void {
  if (marksOfCell.length > 0) view.updateState(withEntryHistoryCleared(view.state));
  dispatchEntryLooks(view, plainLooks(text, marksOfCell), false);
}
export function putEntryValueWithLooks(editor: MountedEntryEditor, text: string, looks: EntryLooks, marksOfCell: FontMark[]): void {
  let { view, element } = editor;
  if (editor.looksShown === undefined) showPlainLooksInEntry(view, element.value, marksOfCell);
  let valueTr = setEntryValue(view.state, text)?.setMeta(WRITTEN_INTO_VALUE_META, true);
  if (valueTr === undefined) return;
  view.dispatch(ProsemirrorHistory.closeHistory(valueTr));
  let looksTr = applyLooksToEntry(view.state, looks)?.setMeta(WRITTEN_INTO_VALUE_META, true);
  if (looksTr !== undefined) view.dispatch(looksTr.setMeta('appendedTransaction', valueTr));
  view.dispatch(ProsemirrorHistory.closeHistory(view.state.tr));
  editor.looksShown = looks;
  editor.valueShown = text;
  editor.hasShownLooks = true;
}
export function syncEntryLooksShown(editor: MountedEntryEditor, text: string, looks: EntryLooks | undefined, marksOfCell: FontMark[]): void {
  let { view, looksShown: looksBefore, valueShown: textBefore } = editor;
  editor.looksShown = looks;
  editor.valueShown = text;
  if (looks === looksBefore && text === textBefore) return;
  if (looks === undefined) {
    if (editor.hasShownLooks) dispatchEntryLooks(view, plainLooks(text, NO_MARKS_OF_CELL), false);
    return;
  }
  editor.hasShownLooks = true;
  let areLooksInPlace = applyLooksToEntry(view.state, looks) === null;
  if (looksBefore === undefined && !areLooksInPlace) showPlainLooksInEntry(view, text, marksOfCell);
  dispatchEntryLooks(view, looks, text === textBefore);
}
export function RichEntryEditor({
  ref,
  value,
  onChange,
  onInput,
  onCompositionEnd,
  isGoing = false,
  references,
  brackets = null,
  looks,
  areLooksSeen = true,
  marksOfCell = NO_MARKS_OF_CELL,
  areSignsRead = false,
  textHeldAsEntryOpened = '',
  areSignsLeftAsTyped = false,
  numbersOfLines = NO_LIST_NUMBERS,
  caretToPut = null,
  onMarkAsked,
  selectionHeld,
  onBoxPressed,
  role = 'textbox',
  ...rest
}: RichEntryEditorProps) {
  let mountRef = React.useRef<HTMLDivElement>(null);
  let editorRef = React.useRef<MountedEntryEditor | null>(null);
  let initialValueRef = React.useRef(value);
  let initialCaretRef = React.useRef(caretToPut);
  let onMarkAskedRef = React.useRef(onMarkAsked);
  let marksOfCellRef = React.useRef(marksOfCell);
  let onBoxPressedRef = React.useRef(onBoxPressed);
  React.useLayoutEffect(() => {
    onMarkAskedRef.current = onMarkAsked;
    marksOfCellRef.current = marksOfCell;
    onBoxPressedRef.current = onBoxPressed;
  });
  let [, rerender] = React.useReducer((count: number) => count + 1, 0);
  React.useLayoutEffect(() => {
    let current = mountRef.current;
    if (current === null) return;
    let entryView = createEntryEditorView(
      current,
      initialValueRef.current,
      (mark) => onMarkAskedRef.current?.(mark),
      () => {
        let editor = editorRef.current;
        if (editor === null || editor.hasShownLooks) return;
        editor.hasShownLooks = true;
        showPlainLooksInEntry(entryView.view, textOfEntryDoc(entryView.view.state.doc), marksOfCellRef.current);
      },
      (line) => onBoxPressedRef.current?.(line),
    );
    editorRef.current = {
      ...entryView,
      element: dressEntryAsTextArea(current, entryView),
      referencesShown: null,
      heldShown: undefined,
      looksShown: undefined,
      hasShownLooks: false,
      valueShown: null,
      numbersShown: NO_LIST_NUMBERS,
      caretPut: initialCaretRef.current,
    };
    return () => {
      editorRef.current = null;
      entryView.end();
    };
  }, []);
  React.useImperativeHandle(ref, () => {
    if (editorRef.current === null) throw Error('the entry’s editor was handed on before it was made');
    return editorRef.current.element;
  }, []);
  React.useLayoutEffect(() => {
    let current = editorRef.current;
    if (isGoing) current?.end();
    if (current === null || current.view.isDestroyed || current.view.composing) return;
    let isCaretToPut = caretToPut !== null && caretToPut !== current.caretPut && caretToPut.text === value;
    if (isCaretToPut && looks !== undefined) putEntryValueWithLooks(current, value, looks, marksOfCell);
    current.element.value = value;
    syncEntryLooksShown(current, value, looks, marksOfCell);
    if (current.heldShown !== selectionHeld) {
      current.heldShown = selectionHeld;
      let { doc, tr } = current.view.state;
      current.view.dispatch(tr.setMeta(selectionHeldKey, selectionHeldDecorations(doc, selectionHeld)));
    }
    if (current.numbersShown.join() !== numbersOfLines.join()) {
      current.numbersShown = numbersOfLines;
      current.view.dispatch(current.view.state.tr.setMeta(listNumbersKey, numbersOfLines));
    }
    // isCaretToPut holds only when caretToPut is not null.
    if (isCaretToPut) current.element.setSelectionRange(caretToPut!.at, caretToPut!.at);
    current.caretPut = caretToPut;
    if (current.referencesShown === references) return;
    current.referencesShown = references;
    let { doc, tr } = current.view.state;
    current.view.dispatch(tr.setMeta(referenceHuesKey, referenceHueDecorations(doc, references)));
  });
  React.useLayoutEffect(() => {
    let view = editorRef.current?.view;
    let win = mountRef.current?.ownerDocument.defaultView ?? null;
    if (brackets === null || win === null || !('highlights' in win.CSS)) return;
    if (win.matchMedia('(forced-colors:active)').matches) return;
    if (view === undefined || view.isDestroyed || view.composing) return;
    let { doc } = view.state;
    let ranges = [brackets.opensAt, brackets.closesAt].map((offset) => {
      let domPos = view.domAtPos(docPosOfTextOffset(doc, offset), 1);
      if (domPos.offset >= (domPos.node.nodeValue?.length ?? 0)) return null;
      let range = win.document.createRange();
      range.setStart(domPos.node, domPos.offset);
      range.setEnd(domPos.node, domPos.offset + 1);
      return range;
    });
    let highlight = new win.Highlight(...ranges.filter((range) => range !== null));
    win.CSS.highlights.set(MATCHING_BRACKETS_CLASS, highlight);
    return () => void win.CSS.highlights.delete(MATCHING_BRACKETS_CLASS);
  });
  let handleInput = (event: React.InputEvent<HTMLDivElement>) => {
    let tellInput = () => {
      onInput?.(event);
      onChange?.({
        target: event.currentTarget,
        nativeEvent: event.nativeEvent,
      });
      rerender();
    };
    if (event.nativeEvent.inputType === 'deleteByDrag') ReactDOM.flushSync(tellInput);
    else tellInput();
    let { inputType, isTrusted, isComposing } = event.nativeEvent;
    if (areSignsRead && inputType === 'insertText' && isTrusted && !isComposing)
      editorRef.current?.readSigns((state) => trOfTypedMarkAtCaret(state, textHeldAsEntryOpened, areSignsLeftAsTyped), 'typed');
  };
  let handleCompositionEnd = (event: React.CompositionEvent<HTMLDivElement>) => {
    onCompositionEnd?.(event);
    rerender();
  };
  return <div ref={mountRef} role={role} tabIndex={0} aria-multiline={role === 'textbox' || undefined} {...{
      [ENTRY_EDITOR_ATTRIBUTE]: true,
    }} data-keeps-looks-unseen={(looks !== undefined && !areLooksSeen) || undefined} data-shows-list={(looks !== undefined && areLooksSeen && hasLists(looks)) || undefined} {...rest} onInput={handleInput} onCompositionEnd={handleCompositionEnd} />;
}
export function EntryInput(props: EntryInputProps) {
  if (props.as === 'textArea') {
    let { as: _textArea, ...textAreaProps } = props;
    return <textarea {...textAreaProps} />;
  }
  let { as: _editor, ...editorProps } = props;
  return <RichEntryEditor {...editorProps} />;
}
export function lingeringEntryProps(props: EntryInputProps): EntryInputProps {
  let { ref: _ref, className: _className, style, ...rest } = props;
  let propsWithoutHandlers = Object.fromEntries(Object.entries(rest).filter(([name]) => !name.startsWith('on')));
  let hiddenProps: Pick<React.HTMLAttributes<HTMLElement>, 'tabIndex' | 'style'> = {
    tabIndex: -1,
    style: {
      ...style,
      position: 'absolute',
      opacity: 0,
      pointerEvents: 'none',
    },
  };
  if (props.as === 'textArea')
    return {
      ...propsWithoutHandlers,
      as: 'textArea',
      readOnly: true,
      ...hiddenProps,
    };
  let { value, references } = props;
  return {
    ...propsWithoutHandlers,
    as: 'editor',
    value,
    references,
    isGoing: true,
    ...hiddenProps,
  };
}
export function LingeringEntryInput({ drawn, ofCell = null }: LingeringEntryInputProps) {
  let [lingering, setLingering] = React.useState<LingeringEntry>({
    drawn,
    ofCell,
    isGoing: false,
    nth: 0,
  });
  if (drawn !== null && drawn !== lingering.drawn) {
    let isNewInput = lingering.isGoing || (lingering.drawn !== null && ofCell !== lingering.ofCell);
    setLingering({
      drawn,
      ofCell,
      isGoing: false,
      nth: isNewInput ? lingering.nth + 1 : lingering.nth,
    });
  }
  if (drawn === null && lingering.drawn !== null && !lingering.isGoing)
    setLingering({
      ...lingering,
      isGoing: true,
    });
  let ref = React.useRef<HTMLTextAreaElement | EntryEditorElement | null>(null);
  let keepElement = React.useCallback((element: HTMLTextAreaElement | EntryEditorElement | null) => void (ref.current = element), []);
  let { isGoing, nth } = lingering;
  React.useEffect(() => {
    let win = ref.current?.ownerDocument.defaultView ?? null;
    if (!isGoing || win === null) return;
    afterNextFrameOrTimeout(
      win,
      () =>
        setLingering(
          (before) =>
            before.isGoing && before.nth === nth
              ? {
                  ...before,
                  drawn: null,
                  isGoing: false,
                  nth: nth + 1,
                }
              : before,
        ),
    );
  }, [isGoing, nth]);
  if (drawn !== null)
    return <EntryInput key={nth} {...drawn} />;
  if (lingering.drawn === null) return null;
  return <EntryInput key={nth} {...lingeringEntryProps(lingering.drawn)} ref={keepElement} data-is-going />;
}
export function boxOfLineAtPoint(target: EventTarget | null, event: Pick<MouseEvent, 'clientX' | 'clientY'>): Element | null {
  let line = target instanceof Element ? target.closest<HTMLElement>(`.sheet-line-in-cell${CHECKBOX_LIST_SELECTOR}`) : null;
  return line !== null && isPressOnListCheckbox(line, event) ? line : null;
}
export function createLineBoxPresses(onPressed: (line: number) => void) {
  let press: LineBoxPress | null = null;
  return {
    pressed(event: React.PointerEvent<Element>, isTaken: boolean): boolean {
      let line =
        event.button === 0 && !(event.shiftKey || event.ctrlKey || event.metaKey) && !isTaken ? boxOfLineAtPoint(event.target, event) : null;
      press =
        line === null
          ? null
          : {
              line: line.getAttribute('data-line') ?? '',
              pointerId: event.pointerId,
            };
      return press !== null;
    },
    letGo(event: React.PointerEvent<Element>, isTaken: boolean): void {
      let pressed = press;
      press = null;
      if (pressed?.pointerId !== event.pointerId || isTaken || event.button !== 0) return;
      let { clientX, clientY, currentTarget } = event;
      let line = boxOfLineAtPoint(currentTarget.ownerDocument.elementFromPoint(clientX, clientY), event);
      let isActive = (line?.closest('[data-is-active]') ?? null) !== null;
      if (line === null || !isActive || line.getAttribute('data-line') !== pressed.line) return;
      onPressed(Number(pressed.line));
    },
  };
}
export function CalculatingSpinner({ isTurning }: CalculatingSpinnerProps) {
  return <span aria-hidden className="grid size-4 flex-none place-content-center text-secondary" onMouseDown={preventMouseDownDefault}>{isTurning &&
      <Spinner size="sm" inheritColor />}</span>;
}
export function undoOfferToShow({ undoOffer, undoOfTurnOffered }: Pick<PageState, 'undoOffer' | 'undoOfTurnOffered'>): UndoOfferShown | null {
  if (undoOfTurnOffered !== null)
    return {
      key: undoOfTurnOffered.edits.at(-1)?.last ?? '',
      ...agentTurnUndoOffer(undoOfTurnOffered),
      taken: 'undoOfTurnTaken',
      wait: undoOfTurnOffered.wait,
    };
  if (undoOffer?.kind !== 'moveReplacedCells') return null;
  return {
    key: `move ${undoOffer.cells} ${undoOffer.count}`,
    ...describeUndoOffer(undoOffer),
    taken: 'undoOfferTaken',
    wait: UNDO_OFFER_WAIT,
  };
}
export const NO_MARKS_OF_CELL: FontMark[] = [];
export const UNDO_OFFER_WAIT: Wait = {
  ms: DONE_CARD_WAIT_MS,
};
