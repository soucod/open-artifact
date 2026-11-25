import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import { isWithinPressGuard } from '../ui/list-under-cell.tsx';
import { TAP_TOTAL_MS } from '../selection/finger-taps.ts';
import { useTextWidth, DEFAULT_CELL_FONT_STYLE, CellChip } from '../grid/cell-drawing.tsx';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { removeItemLabel } from '../i18n/menu-labels.ts';
import { firstLineHeight } from '../grid/cell-metrics-values.ts';
import { isTextInputOrEntryEditor, entryEditorOf } from '../dom/entry-editor.ts';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import type { ReactNode } from 'react';
import type { VerticalAlignment } from '@open-artifact/sheets-core';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { GridPoint } from '../grid/geometry.ts';
import type { FontToMeasure } from '../state/controller.ts';
/** A chip shown in the field, by its key, with the name its remove button tells of. */
export interface ChipInField {
  key: string;
  name: string;
  isGoneTo: boolean;
  chip: Omit<React.ComponentProps<typeof CellChip>, 'after'>;
}
/** Where the field of chips sits over its cell, and how its text keeps clear of the cell's edges. */
export interface FieldOfChipsPlace {
  left: number;
  top: number;
  width: number;
  height: number;
  linesBefore: GridPoint;
  chipsAt: VerticalAlignment;
  clearOfText: StyleWithVariables;
  clipPath?: string;
}
/** The box the field of chips takes on the page. */
export interface FieldOfChipsBox {
  left: number;
  top: number;
  width: number;
  height: number;
}
/** The text typed in the field, and the font it is typed in. */
export interface TypedInField {
  text: string;
  font: FontToMeasure;
}
/** A press on a chip's remove button: of which chip, when, and by what kind of pointer. */
export interface ChipRemovePress {
  key: string;
  atMs: number;
  pointerType: string;
}
/** A click on a chip's remove button: how many clicks it counts, when, and by what kind of pointer if told. */
export interface ChipRemoveClick {
  detail: number;
  atMs: number;
  pointerType: string | undefined;
}
export interface FieldOfChipsProps {
  place: FieldOfChipsPlace | null;
  mostWidth: number;
  keepsToColumn: boolean;
  within: { left: number; right: number };
  chips: readonly ChipInField[];
  onChipRemoved: (key: string) => void;
  onSized: (box: FieldOfChipsBox | null) => void;
  typed: TypedInField | null;
  hint: string;
  children?: ReactNode;
}
export function isChipRemoveClickGenuine(
  click: ChipRemoveClick,
  pointerDown: Pick<ChipRemovePress, 'atMs' | 'pointerType'> | null,
  fieldShownAtMs: number,
): boolean {
  if (click.detail > 1) return false;
  if (pointerDown?.pointerType === 'mouse') return !isWithinPressGuard(fieldShownAtMs, pointerDown.atMs);
  if (pointerDown !== null) return pointerDown.atMs - fieldShownAtMs > TAP_TOTAL_MS;
  if (click.pointerType === undefined) return click.atMs - fieldShownAtMs > TAP_TOTAL_MS;
  return click.pointerType === '';
}
export function FieldOfChips({
  place,
  mostWidth,
  keepsToColumn,
  within,
  chips,
  onChipRemoved,
  onSized,
  typed,
  hint,
  children,
}: FieldOfChipsProps) {
  let fieldRef = React.useRef<HTMLDivElement>(null);
  let shownAtMsRef = React.useRef(0);
  let widestSoFarRef = React.useRef(0);
  let removePressRef = React.useRef<ChipRemovePress | null>(null);
  let textWidth = useTextWidth();
  let isPlaced = place !== null;
  let { left: withinLeft, right: withinRight } = within;
  let roomWidth = withinRight - withinLeft;
  let {
    left,
    top,
    width: cellWidth,
  } = place ?? {
    left: 0,
    top: 0,
    width: 0,
  };
  let leastWidth = Math.min(cellWidth, roomWidth);
  let mostWidthInRoom = Math.min(Math.max(cellWidth, mostWidth), roomWidth);
  let measure = React.useCallback(() => {
    let field = fieldRef.current;
    if (field === null || !isPlaced) return;
    let { offsetWidth, offsetHeight } = field;
    let computedWidth = Number.parseFloat(field.ownerDocument.defaultView?.getComputedStyle(field).width ?? '');
    if (computedWidth > widestSoFarRef.current) {
      widestSoFarRef.current = computedWidth;
      field.style.setProperty(FIELD_WIDTH_SO_FAR_PROPERTY, `${String(computedWidth)}px`);
    }
    onSized({
      left: Math.max(withinLeft, Math.min(left, withinRight - offsetWidth)),
      top,
      width: offsetWidth,
      height: offsetHeight,
    });
  }, [onSized, isPlaced, left, top, withinLeft, withinRight]);
  React.useLayoutEffect(measure);
  React.useLayoutEffect(() => {
    let field = fieldRef.current;
    let defaultView = field?.ownerDocument.defaultView ?? null;
    if (field === null || defaultView === null || !isPlaced) return;
    shownAtMsRef.current = performanceNowOf(field);
    removePressRef.current = null;
    let resizeObserver = new defaultView.ResizeObserver(measure);
    resizeObserver.observe(field);
    return () => {
      resizeObserver.disconnect();
      widestSoFarRef.current = 0;
      field.style.removeProperty(FIELD_WIDTH_SO_FAR_PROPERTY);
      onSized(null);
    };
  }, [onSized, isPlaced, measure]);
  let fieldStyle: StyleWithVariables =
    place === null
      ? CHIP_FIELD_HIDDEN_STYLE
      : {
          ...DEFAULT_CELL_FONT_STYLE,
          ...place.clearOfText,
          left,
          top,
          translate: `clamp(${String(withinLeft - left)}px, ${String(withinRight - left)}px - 100%, 0px)`,
          minHeight: place.height,
          alignContent: CHIPS_AT_ALIGN_CONTENT[place.chipsAt],
          '--sheet-least-width-of-field': `${String(leastWidth)}px`,
          '--sheet-most-width-of-field': `${String(mostWidthInRoom)}px`,
          '--sheet-line-over-field': `${String(place.linesBefore.y)}px`,
          '--sheet-line-before-field': `${String(place.linesBefore.x)}px`,
          '--sheet-width-of-typed': `${String(Math.ceil(Math.max(textWidth(hint, DEFAULT_CELL_FORMAT.font), typed === null ? 0 : textWidth(typed.text, typed.font))) + TYPED_WIDTH_SLACK_PX)}px`,
          ...(place.clipPath !== undefined && {
            clipPath: place.clipPath,
          }),
        };
  return <div ref={fieldRef} role="presentation" className={isPlaced ? 'sheet-field-of-chips' : undefined} data-keeps-to-column={(isPlaced && keepsToColumn) || undefined} style={fieldStyle} {...(isPlaced && CHIP_FIELD_EVENT_FENCE)}>{(isPlaced ? chips : []).map(
        ({ key, name, isGoneTo, chip }) =>
          (<span key={key} className="sheet-field-of-chips-chip" data-is-gone-to={isGoneTo || undefined}><CellChip {...chip} after={<button type="button" tabIndex={-1} className="sheet-chip-remove" aria-label={removeItemLabel(name)} onPointerDown={({ pointerType, currentTarget }) => {
                    removePressRef.current = {
                      key,
                      atMs: performanceNowOf(currentTarget),
                      pointerType,
                    };
                  }} onPointerCancel={() => {
                    removePressRef.current = null;
                  }} onClick={({ detail, currentTarget, nativeEvent }) => {
                    let removePress = removePressRef.current?.key === key ? removePressRef.current : null;
                    removePressRef.current = null;
                    let pointerType = 'pointerType' in nativeEvent ? String(nativeEvent.pointerType) : undefined;
                    let click = {
                      detail,
                      atMs: performanceNowOf(currentTarget),
                      pointerType,
                    };
                    if (isChipRemoveClickGenuine(click, removePress, shownAtMsRef.current)) onChipRemoved(key);
                  }}><Icon name="X" size="xs" /></button>} /></span>),
      )}{children}{isPlaced &&
        typed === null &&
        <span aria-hidden className="sheet-field-of-chips-caret" data-is-away={chips.some(({ isGoneTo }) => isGoneTo) || undefined}>{hint}</span>}</div>;
}
export const CHIP_FIELD_LINE_HEIGHT = firstLineHeight(DEFAULT_CELL_FORMAT.font.size);
export const CHIPS_AT_ALIGN_CONTENT: Record<VerticalAlignment, string> = {
  top: 'flex-start',
  center: 'center',
  bottom: 'flex-end',
};
export const FIELD_WIDTH_SO_FAR_PROPERTY = '--sheet-width-of-field-so-far';
export const TYPED_WIDTH_SLACK_PX = 8;
export const performanceNowOf = (element: Element): number => element.ownerDocument.defaultView?.performance.now() ?? 0;
export const stopChipFieldEvent = (event: React.SyntheticEvent): void => event.stopPropagation();
export const CHIP_FIELD_EVENT_FENCE = {
  onMouseDown(event: React.MouseEvent) {
    if (!isTextInputOrEntryEditor(entryEditorOf(event.target))) preventMouseDownDefault(event);
    stopChipFieldEvent(event);
  },
  onPointerDown: stopChipFieldEvent,
  onPointerUp: stopChipFieldEvent,
  onPointerMove: stopChipFieldEvent,
  onClick: stopChipFieldEvent,
  onDoubleClick: stopChipFieldEvent,
  onContextMenu: stopChipFieldEvent,
};
export const CHIP_FIELD_HIDDEN_STYLE: StyleWithVariables = {
  display: 'contents',
};
