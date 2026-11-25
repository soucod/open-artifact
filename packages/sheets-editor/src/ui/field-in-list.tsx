import { menuItemVariants } from '../kit/menu.tsx';
import * as React from 'react';
import { isInListUnderCell } from './list-under-cell.tsx';
import { CellChip } from '../grid/cell-drawing.tsx';
import type { ChipPaints } from '../grid/cell-drawing.tsx';
import { LiveAnnouncer } from './live-announcer.tsx';
/** What a key pressed in a field of a list does: nothing, leave it to the text, or enter or drop the text and stay or leave. */
export type FieldInListKeyAction = 'leftToText' | 'nothing' | 'dropAndLeave' | 'enterAndLeave' | 'enterAndStay';
/** What a key press in a field of a list comes with. */
export interface FieldInListKeyPress {
  isOfInputMethod: boolean;
  isForNew: boolean;
  isBlank: boolean;
  isHeldDown: boolean;
}
/** What came of entering the text typed in a field of a list. */
export type FieldInListEntryOutcome = 'nothingTyped' | 'restored' | 'entered' | 'refused';
/** The texts a field of a list weighs what is typed against: what it holds at rest, what is on its way, what was dealt with, and why it is refused. */
export interface TextsBesideTyped {
  atRest: string;
  onItsWay: string | null;
  dealtWith: string | null;
  refusal: string | null;
}
/** What a field of a list does when the caret leaves it. */
export type FieldInListBlurAction = 'entersAndEnds' | 'nothing' | 'saysCaretHasGone';
/** A field of a list once its text was entered: what it shows, what was entered, what it holds, and whether the entry is there. */
export interface FieldAfterEntry {
  shown: string;
  entered: string;
  value: string;
  isThere: boolean;
  isForNew: boolean;
}
/** What has become of a field of a list after the list changed. */
export interface FieldInListChange {
  isFieldGone: boolean;
  isCaretOnBody: boolean;
  isListShutting: boolean;
}
/** What a field of a list does after the list changed. */
export type FieldInListAfterChange = 'staysAsItIs' | 'caretGoesBack' | 'textIsEnteredAndCaretGoesBack';
/** How the text of a field of a list was entered: by a press outside it, or by a key. */
export type FieldEnteredBy = 'press' | 'key';
/** Where a press outside a field of a list lands. */
export type PressAroundFieldInList = 'elsewhere' | 'ownRow' | 'restOfListOrCard' | 'rowThatAsksForNext' | 'rowThatDropsText' | 'rowOrButton';
/** Which press of the mouse is weighed: the button going down, or the click. */
export type PressOfField = 'click' | 'pointerdown';
/** How the field draws the text typed in it as a chip. */
export interface FieldChip {
  paints: ChipPaints;
  isPillDrawn: boolean;
}
export interface FieldInListProps {
  name: string;
  value: string;
  placeholder?: string;
  lead?: React.ReactNode;
  asTyped: (text: string) => string;
  namesPasted: (clipboard: DataTransfer) => string[];
  whyRefused: (text: string) => string | null;
  onEntered: (names: string[], onDone: (isThere: boolean) => void) => void;
  isForNew?: boolean;
  asChip?: (typed: string) => FieldChip;
  doesPressDropText?: (rowOrButton: Element) => boolean;
  doesPressAskForNext?: (rowOrButton: Element) => boolean;
  timesAsked?: number;
  onOverWithoutKey?: () => void;
  onLeftByKey: () => void;
  onCaretChange: (hasCaret: boolean, field: HTMLInputElement) => void;
  onTypedChange: (typed: string | null) => void;
}
/** Text typed in the field that was refused, and whether the refusal is drawn under it. */
interface FieldRefusal {
  text: string;
  isDrawn: boolean;
}
/** What presses outside the field reach through, kept up to date on every render. */
interface FieldInListHandlers {
  enter: (how: FieldEnteredBy) => boolean;
  doesPressDropText: FieldInListProps['doesPressDropText'];
  doesPressAskForNext: FieldInListProps['doesPressAskForNext'];
  endWithoutKey: () => void;
}
export function fieldInListKeyAction(
  key: string,
  { isOfInputMethod, isForNew, isBlank, isHeldDown }: FieldInListKeyPress,
): FieldInListKeyAction {
  if (isOfInputMethod) return 'leftToText';
  if (isHeldDown && (key === 'Escape' || key === 'Tab' || key === 'Enter')) return 'nothing';
  if (key === 'Escape') return 'dropAndLeave';
  if (key === 'Tab') return 'enterAndLeave';
  if (key === 'Enter') return isForNew && !isBlank ? 'enterAndStay' : 'enterAndLeave';
  return 'leftToText';
}
export function fieldInListEntryOutcome(
  typed: string,
  { atRest, onItsWay, dealtWith, refusal }: TextsBesideTyped,
): FieldInListEntryOutcome {
  if (typed === atRest || typed === onItsWay || typed === dealtWith) return 'nothingTyped';
  if (typed.trim() === '') return 'restored';
  return refusal === null ? 'entered' : 'refused';
}
export function fieldInListBlurAction(isChip: boolean, isCaretGoneNowhere: boolean): FieldInListBlurAction {
  if (isChip) return 'entersAndEnds';
  return isCaretGoneNowhere ? 'nothing' : 'saysCaretHasGone';
}
export function fieldTextAfterEntry({ shown, entered, value, isThere, isForNew }: FieldAfterEntry): string {
  if (isForNew) return !isThere && shown === '' ? entered : shown;
  return shown === entered ? value : shown;
}
export function fieldInListAfterListChange(
  typed: string | null,
  { isFieldGone, isCaretOnBody, isListShutting }: FieldInListChange,
): FieldInListAfterChange {
  if (!(isFieldGone && isCaretOnBody) && !isListShutting) return 'staysAsItIs';
  return typed === null ? 'caretGoesBack' : 'textIsEnteredAndCaretGoesBack';
}
export function FieldInList({
  name,
  value,
  placeholder,
  lead,
  asTyped,
  namesPasted,
  whyRefused,
  onEntered,
  isForNew,
  asChip,
  doesPressDropText,
  doesPressAskForNext,
  timesAsked,
  onOverWithoutKey,
  onLeftByKey,
  onCaretChange,
  onTypedChange,
}: FieldInListProps) {
  let [typed, setTyped] = React.useState(value);
  let [onItsWay, setOnItsWay] = React.useState<string | null>(null);
  let [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (typed === lastValue) setTyped(value);
  }
  let valueRef = React.useRef(value);
  React.useEffect(() => {
    valueRef.current = value;
  });
  let [isFocused, setIsFocused] = React.useState(false);
  let [refusal, setRefusal] = React.useState<FieldRefusal | null>(null);
  let refusalShown =
    refusal === null
      ? null
      : {
          words: whyRefused(refusal.text),
          isDrawn: refusal.isDrawn,
        };
  let atRest = isForNew === true ? '' : value;
  let isTypedChanged = typed !== atRest && typed !== onItsWay;
  let handlersRef = React.useRef<FieldInListHandlers>({
    enter: () => true,
    doesPressDropText,
    doesPressAskForNext,
    endWithoutKey: () => {},
  });
  let isChip = asChip !== undefined;
  let dealtWithRef = React.useRef<string | null>(null);
  let enterNames = (names: string[]) => {
    let [firstName] = names;
    let typedBefore = typed;
    dealtWithRef.current = typedBefore;
    onTypedChange(null);
    setOnItsWay(firstName);
    if (isForNew === true) setTyped('');
    onEntered(names, (isThere) => {
      setOnItsWay((wasOnItsWay) => (wasOnItsWay === firstName ? null : wasOnItsWay));
      setTyped(
        (shown) =>
          fieldTextAfterEntry({
            shown,
            entered: firstName,
            value: valueRef.current,
            isThere,
            isForNew: isForNew === true,
          }),
      );
      if (isThere) return;
      if (dealtWithRef.current === typedBefore) dealtWithRef.current = null;
      setRefusal({
        text: firstName,
        isDrawn: true,
      });
    });
  };
  let enterTyped = (how: FieldEnteredBy) => {
    let outcome = fieldInListEntryOutcome(typed, {
      atRest,
      onItsWay,
      dealtWith: dealtWithRef.current,
      refusal: whyRefused(typed),
    });
    if (outcome === 'restored' || (outcome === 'refused' && how === 'press')) setTyped(atRest);
    if (outcome === 'refused')
      setRefusal({
        text: typed,
        isDrawn: how === 'key',
      });
    if (outcome === 'entered') enterNames([typed]);
    return outcome !== 'refused';
  };
  let isEndedRef = React.useRef(false);
  let endWithoutKey = () => {
    if (isEndedRef.current) return;
    isEndedRef.current = true;
    onOverWithoutKey?.();
  };
  let leaveByKey = () => {
    isEndedRef.current = true;
    onLeftByKey();
  };
  let typedToOffer = isTypedChanged && typed.trim() !== '' && whyRefused(typed) === null ? typed : null;
  React.useEffect(() => onTypedChange(typedToOffer), [typedToOffer, onTypedChange]);
  let rowRef = React.useRef<HTMLDivElement>(null);
  let inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    handlersRef.current = {
      enter: enterTyped,
      doesPressDropText,
      doesPressAskForNext,
      endWithoutKey,
    };
  });
  React.useEffect(() => {
    let fieldDocument = inputRef.current?.ownerDocument;
    if (!isFocused || (!isTypedChanged && !isChip) || fieldDocument === undefined) return;
    let whereIsPress = (pressTarget: EventTarget | null): PressAroundFieldInList => {
      if (!(pressTarget instanceof Element)) return 'elsewhere';
      if (rowRef.current?.contains(pressTarget) === true) return 'ownRow';
      if (!isInListUnderCell(pressTarget) || pressTarget.closest(`[${ROW_OF_FIELD_IN_LIST_ATTRIBUTE}]`) !== null) return 'elsewhere';
      let rowOrButton = pressTarget.closest(LIST_ROW_OR_BUTTON_SELECTOR);
      if (rowOrButton === null) return 'restOfListOrCard';
      if (handlersRef.current.doesPressAskForNext?.(rowOrButton) === true) return 'rowThatAsksForNext';
      return handlersRef.current.doesPressDropText?.(rowOrButton) === true ? 'rowThatDropsText' : 'rowOrButton';
    };
    let onPressOutside = ({ type, target }: Event) => {
      let pressedWhere = whereIsPress(target);
      if (pressedWhere === 'rowThatDropsText' && type === 'click') onTypedChange(null);
      if (!doesPressEnterFieldInList(pressedWhere, type === 'click' ? 'click' : 'pointerdown')) return;
      handlersRef.current.enter(isPressThatEndsField(pressedWhere) ? 'press' : 'key');
      if (isPressThatEndsField(pressedWhere)) handlersRef.current.endWithoutKey();
    };
    fieldDocument.addEventListener('pointerdown', onPressOutside, true);
    fieldDocument.addEventListener('click', onPressOutside, true);
    return () => {
      fieldDocument.removeEventListener('pointerdown', onPressOutside, true);
      fieldDocument.removeEventListener('click', onPressOutside, true);
    };
  }, [isFocused, isTypedChanged, isChip, onTypedChange]);
  React.useLayoutEffect(() => {
    if (timesAsked === undefined) return;
    let sheetFrame = inputRef.current?.closest('[data-presentation="sheet"]') ?? null;
    inputRef.current?.focus({
      preventScroll: sheetFrame === null,
    });
  }, [timesAsked]);
  let typeText = (text: string) => {
    dealtWithRef.current = null;
    setTyped(asTyped(text));
    setRefusal(null);
  };
  let onKeyDownInField = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    let isOfInputMethod = event.nativeEvent.isComposing || event.keyCode === 229;
    let keyAction = fieldInListKeyAction(event.key, {
      isOfInputMethod,
      isForNew: isForNew === true,
      isBlank: typed.trim() === '',
      isHeldDown: event.repeat,
    });
    if (keyAction === 'leftToText') return;
    event.preventDefault();
    if (keyAction === 'nothing') return;
    if (keyAction === 'dropAndLeave') {
      dealtWithRef.current = typed;
      setTyped(atRest);
      setRefusal(null);
      onTypedChange(null);
      leaveByKey();
    } else if (enterTyped('key') && keyAction === 'enterAndLeave') leaveByKey();
  };
  let onPasteInField = (event: React.ClipboardEvent<HTMLInputElement>) => {
    let [firstName, ...otherNames] = namesPasted(event.clipboardData);
    if (firstName === undefined || otherNames.length === 0) return;
    event.preventDefault();
    let { value: fieldText, selectionStart, selectionEnd } = event.currentTarget;
    let [textBefore, textAfter] = [
      fieldText.slice(0, selectionStart ?? fieldText.length),
      fieldText.slice(selectionEnd ?? fieldText.length),
    ];
    if (isForNew === true) enterNames([asTyped(textBefore + firstName + textAfter), ...otherNames]);
    else typeText(textBefore + [firstName, ...otherNames].join(' ') + textAfter);
  };
  let wasUnfocusedAtPressRef = React.useRef(false);
  let inputElement = <input ref={inputRef} {...{
      [FIELD_IN_LIST_ATTRIBUTE]: '',
    }} tabIndex={-1} aria-label={name} aria-invalid={(refusalShown?.isDrawn === true && refusalShown.words !== null) || undefined} placeholder={placeholder} value={typed} spellCheck={false} autoComplete="off" autoCorrect="off" {...(asChip === undefined ? FIELD_INPUT_PROPS : FIELD_INPUT_OVER_CHIP_PROPS)} onChange={(event) => typeText(event.target.value)} onPaste={onPasteInField} onFocus={({ currentTarget }) => {
      isEndedRef.current = false;
      setIsFocused(true);
      onCaretChange(true, currentTarget);
    }} onBlur={({ relatedTarget, currentTarget }) => {
      setIsFocused(false);
      let blurAction = fieldInListBlurAction(isChip, relatedTarget === null);
      if (blurAction === 'nothing') return;
      if (blurAction === 'saysCaretHasGone') return onCaretChange(false, currentTarget);
      enterTyped('press');
      onCaretChange(false, currentTarget);
      return endWithoutKey();
    }} onMouseDown={stopFieldEventPropagation} onPointerDown={stopFieldEventPropagation} onPointerDownCapture={(event) => {
      wasUnfocusedAtPressRef.current = event.currentTarget.ownerDocument.activeElement !== event.currentTarget;
    }} onClick={(event) => {
      stopFieldEventPropagation(event);
      let { selectionStart, selectionEnd } = event.currentTarget;
      if (wasUnfocusedAtPressRef.current && selectionStart === selectionEnd) event.currentTarget.select();
      wasUnfocusedAtPressRef.current = false;
    }} onKeyDown={onKeyDownInField} onKeyUp={stopFieldEventPropagation} />;
  return <div ref={rowRef} {...{
      [ROW_OF_FIELD_IN_LIST_ATTRIBUTE]: '',
    }} className={asChip === undefined ? FIELD_ROW_CLASSES : FIELD_CHIP_ROW_CLASSES} data-highlighted={(asChip !== undefined && isFocused) || undefined}><div className="flex min-w-0 flex-1 flex-col"><label className="flex min-w-0 cursor-text items-center gap-xs">{lead}{asChip === undefined
              ? inputElement
              : <span {...(asChip(typed).isPillDrawn ? FIELD_CHIP_PILL_PROPS : FIELD_CHIP_PLAIN_PROPS)}><CellChip optionPaints={asChip(typed).paints}><span className="relative block min-w-[1ch] max-w-full overflow-hidden whitespace-pre"><span aria-hidden {...FIELD_TEXT_COPY_PROPS}>{typed === '' ? (placeholder ?? ' ') : typed}</span>{inputElement}</span></CellChip></span>}</label>{refusalShown?.isDrawn === true &&
          refusalShown.words !== null &&
          <p aria-hidden className="pt-0.5 text-footnote text-danger">{refusalShown.words}</p>}<LiveAnnouncer words={refusalShown?.words} /></div></div>;
}
export const doesPressEnterFieldInList = (pressedWhere: PressAroundFieldInList, press: PressOfField): boolean =>
  pressedWhere === 'elsewhere' ? press === 'pointerdown' : (pressedWhere === 'rowOrButton' || pressedWhere === 'rowThatAsksForNext') && press === 'click';
export const isPressThatEndsField = (pressedWhere: PressAroundFieldInList): boolean => pressedWhere !== 'rowThatAsksForNext';
export const FIELD_IN_LIST_ATTRIBUTE = 'data-field-in-list';
export const isFieldInList = (target: EventTarget | null): boolean => target instanceof Element && target.hasAttribute(FIELD_IN_LIST_ATTRIBUTE);
export const ROW_OF_FIELD_IN_LIST_ATTRIBUTE = 'data-row-of-field-in-list';
export const FIELD_ROW_CLASSES = menuItemVariants({
  className: 'cursor-text hover:bg-fill-ghost-hover focus-within:bg-transparent focus-within:hover:bg-transparent',
});
export const FIELD_INPUT_PROPS = {
  className: 'min-w-0 flex-1 bg-transparent text-body text-primary outline-none placeholder:text-primary focus:placeholder:text-muted',
};
export const FIELD_INPUT_OVER_CHIP_PROPS = {
  className: 'absolute inset-0 w-full bg-transparent p-0 font-[inherit] text-[length:inherit] text-inherit outline-none placeholder:text-secondary',
};
export const FIELD_TEXT_COPY_PROPS = {
  className: 'sheet-copy-of-field-text invisible',
};
export const FIELD_CHIP_PILL_PROPS = {
  className: 'flex min-w-0 flex-1',
};
export const FIELD_CHIP_PLAIN_PROPS = {
  className: `${FIELD_CHIP_PILL_PROPS.className} [&>.sheet-chip]:bg-transparent! [&>.sheet-chip]:text-primary!`,
};
export const LIST_ROW_OR_BUTTON_SELECTOR = '[role="option"], button';
export const FIELD_CHIP_ROW_CLASSES = menuItemVariants({
  className: 'cursor-text',
});
export const stopFieldEventPropagation = (event: React.SyntheticEvent): void => event.stopPropagation();
