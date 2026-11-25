import { TextInput } from '../kit/text-input.tsx';
import { Button } from '../kit/button.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import type { ReactNode } from 'react';
import type { CaretAtEnd } from '../state/initial-state.ts';
import type { PaneRect } from './geometry.ts';
import { DEFAULT_LINES_TO_ADD, parseLineCount } from './lines-at-end.ts';
import type { AddColumnsControlBox } from './lines-at-end.ts';
import { MESSAGE_LOCALE } from '../i18n/messages.ts';
import { rowsFieldTextParts, enterNumberUpToHint } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { MENU_CARETS } from '../ui/menu-trigger.tsx';
import { boxInBody } from './grid-drawing.tsx';
/** Adds rows or columns at the end of the sheet. */
export type AddLinesAtEnd = (what: CaretAtEnd, count: number) => void;
/** Tells that the caret came to the rows or columns at the end of the sheet, or left them (null) for the element focused next. */
export type CaretAtEndTold = (at: CaretAtEnd | null, nextFocus?: Element | null) => void;
export interface AtEndOfSheetProps {
  adds: CaretAtEnd;
  /** Whether the controls are past the shown part of the grid. */
  isOutOfView: boolean;
  className: string;
  style: React.CSSProperties;
  onCaretAtEnd: CaretAtEndTold;
  onCaretLost: () => void;
  children: ReactNode;
}
export interface AddRowsAtFootProps {
  most: number;
  onAdd: AddLinesAtEnd;
}
export interface AddColumnsButtonsProps {
  isColumnCountCardOpen: boolean;
  onAdd: AddLinesAtEnd;
  onColumnCountAsked: (isByKey: boolean) => void;
}
/** The part of the grid drawn that the controls at its end are placed by. */
export interface GridEndToAddAt {
  body: PaneRect;
  mostRowsToAdd: number;
  roomOfWhatAddsRows: PaneRect | null;
  headerThatAddsColumns: AddColumnsControlBox | null;
}
export interface AddAtEndOfSheetProps extends AddColumnsButtonsProps {
  grid: GridEndToAddAt;
  onCaretAtEnd: CaretAtEndTold;
  onCaretLost: () => void;
}
export function focusAtEndOfSheetField(field: EventTarget | null, step: number): boolean {
  if (!(field instanceof HTMLElement)) return false;
  let fields = [...(field.closest('.sheet-grid')?.querySelectorAll<HTMLElement>(AT_END_OF_SHEET_FIELDS) ?? [])];
  let fieldToFocus = fields[fields.indexOf(field) + step];
  fieldToFocus?.focus({
    preventScroll: true,
  });
  return fieldToFocus !== undefined;
}
export function AtEndOfSheet({
  adds,
  isOutOfView,
  className,
  style,
  onCaretAtEnd,
  onCaretLost,
  children,
}: AtEndOfSheetProps) {
  let boxRef = React.useRef<HTMLDivElement>(null);
  let onCaretLostNow = React.useEffectEvent(onCaretLost);
  React.useLayoutEffect(() => {
    let { current: box } = boxRef;
    return () => {
      if (box?.contains(box.ownerDocument.activeElement) === true) onCaretLostNow();
    };
  }, []);
  return <div ref={boxRef} className={className} {...{
      [AT_END_OF_SHEET_ATTRIBUTE]: true,
    }} style={style} onFocus={() => onCaretAtEnd(adds)} onBlur={({ currentTarget, relatedTarget }) => {
      let activeElement = isOutOfView ? currentTarget.ownerDocument.activeElement : null;
      if (!currentTarget.contains(relatedTarget ?? activeElement)) onCaretAtEnd(null, relatedTarget);
    }}>{children}</div>;
}
export function AddRowsAtFoot({ most, onAdd }: AddRowsAtFootProps) {
  let defaultCountTyped = Math.min(DEFAULT_LINES_TO_ADD, most).toLocaleString(MESSAGE_LOCALE);
  let [countTyped, setCountTyped] = React.useState(defaultCountTyped);
  let hintId = React.useId();
  let isSelectedOnFocusRef = React.useRef(false);
  let count = parseLineCount(countTyped);
  if (count !== null && count > most) setCountTyped(most.toLocaleString(MESSAGE_LOCALE));
  let isCountInvalid = countTyped.trim() !== '' && count === null;
  let addRows = () => {
    if (count !== null) onAdd('rows', count);
  };
  let [countLimitNote, countHint] = rowsFieldTextParts(count ?? DEFAULT_LINES_TO_ADD);
  return <><Button variant="ghost" icon="Add" tabIndex={AT_END_TAB_INDEX} aria-label={count === null ? undefined : sheetMessages.addRowsAtFoot(count)} onClick={addRows}>{sheetMessages.add()}</Button>{!isCountInvalid && countLimitNote}<TextInput className="sheet-add-rows-count" fullWidth={false} inputMode="numeric" aria-label={sheetMessages.rowsToAdd()} aria-describedby={hintId} aria-invalid={isCountInvalid} value={countTyped} onChange={({ currentTarget: { value: typed } }) => {
          isSelectedOnFocusRef.current = false;
          setCountTyped(typed);
        }} onFocus={({ currentTarget }) => {
          currentTarget.select();
          isSelectedOnFocusRef.current = true;
        }} onMouseUp={(event) => {
          if (isSelectedOnFocusRef.current) event.preventDefault();
          isSelectedOnFocusRef.current = false;
        }} onBlur={() => setCountTyped(count?.toLocaleString(MESSAGE_LOCALE) ?? defaultCountTyped)} onKeyDown={({ key, keyCode, repeat, nativeEvent }) => {
          let isComposing = nativeEvent.isComposing || keyCode === 229;
          if (key === 'Enter' && !repeat && !isComposing) addRows();
        }} /><span id={hintId}>{isCountInvalid ? enterNumberUpToHint(most) : countHint}</span><LiveAnnouncer words={isCountInvalid && enterNumberUpToHint(most)} /></>;
}
export function AddColumnsButtons({
  isColumnCountCardOpen,
  onAdd,
  onColumnCountAsked,
}: AddColumnsButtonsProps) {
  return <TooltipGroup><Tooltip content={sheetMessages.addColumn()} side="top" hoverable={false}><button type="button" className="sheet-add-column" tabIndex={AT_END_TAB_INDEX} aria-label={sheetMessages.addColumn()} onClick={() => onAdd('columns', 1)}><Icon name="Add" size="xs" /></button></Tooltip><Tooltip content={sheetMessages.addMoreColumns()} side="top" hoverable={false} {...(isColumnCountCardOpen
          ? {
              open: false,
            }
          : {})}><button type="button" id={ADD_MORE_COLUMNS_BUTTON_ID} className="sheet-add-more-columns" tabIndex={AT_END_TAB_INDEX} aria-label={sheetMessages.addMoreColumns()} aria-haspopup="dialog" aria-expanded={isColumnCountCardOpen} onClick={({ detail }) => onColumnCountAsked(detail === 0)}>{MENU_CARETS.tab}</button></Tooltip></TooltipGroup>;
}
export function AddAtEndOfSheet({ grid, onCaretAtEnd, onCaretLost, ...addProps }: AddAtEndOfSheetProps) {
  let {
    body,
    mostRowsToAdd,
    roomOfWhatAddsRows,
    headerThatAddsColumns,
  } = grid;
  return <>{roomOfWhatAddsRows !== null &&
        <AtEndOfSheet adds="rows" isOutOfView={roomOfWhatAddsRows.top >= body.height} className="sheet-add-rows" style={boxInBody(roomOfWhatAddsRows, body)} onCaretAtEnd={onCaretAtEnd} onCaretLost={onCaretLost}><AddRowsAtFoot most={mostRowsToAdd} {...addProps} /></AtEndOfSheet>}{headerThatAddsColumns !== null &&
        (<AtEndOfSheet adds="columns" isOutOfView={headerThatAddsColumns.left >= body.width} className="sheet-add-columns" style={{
            left: body.left + headerThatAddsColumns.left,
            width: headerThatAddsColumns.width,
            height: body.top,
          }} onCaretAtEnd={onCaretAtEnd} onCaretLost={onCaretLost}><AddColumnsButtons {...addProps} /></AtEndOfSheet>)}</>;
}
export const AT_END_OF_SHEET_ATTRIBUTE = 'data-is-at-end-of-sheet';
export const AT_END_OF_SHEET_FIELDS = `[${AT_END_OF_SHEET_ATTRIBUTE}] :is(button,input)`;
export const isInAtEndOfSheet = (target: EventTarget | null | undefined): boolean => target instanceof Element && target.closest(AT_END_OF_SHEET_FIELDS) !== null;
export const isAtEndOfSheetInput = (target: EventTarget | null | undefined): boolean => target instanceof HTMLInputElement && isInAtEndOfSheet(target);
export const ADD_MORE_COLUMNS_BUTTON_ID = 'asks-how-many-columns';
export const AT_END_TAB_INDEX = 0;
