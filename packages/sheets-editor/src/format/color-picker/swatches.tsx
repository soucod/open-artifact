import { Tooltip, TooltipGroup } from '../../kit/tooltip.tsx';
import type { Color } from '@open-artifact/sheets-core';
import * as React from 'react';
import { NO_COLOR, GRAYSCALE_COLORS, STANDARD_HUE_COLORS, colorsEqual } from '../../model/colors.ts';
import { swallowRestOfPress } from '../../ui/press-swallow.ts';
import { cellColorName } from '../../i18n/format-labels.ts';
import type { ColorProperty } from '../../i18n/format-labels.ts';
import { fillPaintStyle } from '../../grid/cell-drawing.tsx';
import { shownCellColor } from '../cell-colors.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
/** A step for an arrow key, across and down (in the reading direction). */
export type FocusStep = [stepX: number, stepY: number];
export interface ColorSwatchesProps {
  property: ColorProperty;
  /** The color the cells have, or null when they differ. */
  current: Color | null;
  colorsInSheet: Color[];
  onChosen: (color: Color) => void;
}
export function elementStartCorner(element: Element): [x: number, y: number] {
  let bounds = element.getBoundingClientRect();
  return [getComputedStyle(element).direction === 'rtl' ? bounds.right : bounds.left, bounds.top];
}
export function nearestElementInDirection<Candidate extends Element>(from: Element, candidates: Candidate[], [stepX, stepY]: FocusStep): Candidate | null {
  let [fromX, fromY] = elementStartCorner(from);
  let nearest: { element: Candidate; distance: number } | null = null;
  for (let candidate of candidates) {
    let [x, y] = elementStartCorner(candidate);
    let along = (x - fromX) * stepX + (y - fromY) * stepY;
    let across = Math.abs((x - fromX) * stepY) + Math.abs((y - fromY) * stepX);
    if (along < 1 || (stepY === 0 && across >= 1)) continue;
    let distance = along * 1000 + across;
    if (nearest === null || distance < nearest.distance)
      nearest = {
        element: candidate,
        distance,
      };
  }
  return nearest?.element ?? null;
}
export function moveFocusAmongSwatches(event: React.KeyboardEvent<HTMLButtonElement>) {
  let step = ARROW_KEY_FOCUS_STEPS.get(event.key);
  if (step === undefined || (event.ctrlKey && event.altKey)) return;
  event.preventDefault();
  event.stopPropagation();
  let swatch = event.currentTarget;
  let otherSwatches = [...(swatch.closest(`.${SWATCHES_CLASS_NAME}`)?.querySelectorAll('button') ?? [])].filter(
    (other) => other !== swatch,
  );
  nearestElementInDirection(swatch, otherSwatches, step)?.focus({
    preventScroll: true,
  });
}
export function ColorSwatches(props: ColorSwatchesProps) {
  let { property, current, colorsInSheet, onChosen } = props;
  let [focusedKey, setFocusedKey] = React.useState(swatchColorKey(current ?? NO_COLOR));
  let colors = [NO_COLOR, ...GRAYSCALE_COLORS, ...STANDARD_HUE_COLORS, ...colorsInSheet];
  let tabStopKey = swatchColorKey(
    colors.find((color) => swatchColorKey(color) === focusedKey) ??
      colors.find((color) => current !== null && colorsEqual(current, color)) ??
      NO_COLOR,
  );
  let swatchProps = (color: Color): React.ButtonHTMLAttributes<HTMLButtonElement> => ({
    type: 'button',
    'aria-pressed': current !== null && colorsEqual(current, color),
    tabIndex: swatchColorKey(color) === tabStopKey ? 0 : -1,
    onFocus: () => setFocusedKey(swatchColorKey(color)),
    onKeyDown: moveFocusAmongSwatches,
    onClick: (event) => {
      swallowRestOfPress(event);
      onChosen(color);
    },
  });
  let renderSwatches = (swatchColors: Color[]) =>
    swatchColors.map((color) => {
      let name = cellColorName(property, color);
      return <Tooltip key={swatchColorKey(color)} content={name} side="top" hoverable={false}><button {...swatchProps(color)} aria-label={name} className="sheet-swatch" data-has-fill style={fillPaintStyle(shownCellColor(property, color))} /></Tooltip>;
    });
  return <TooltipGroup><div className={SWATCHES_CLASS_NAME}><button {...swatchProps(NO_COLOR)} className="sheet-no-color"><span aria-hidden className="sheet-swatch" />{cellColorName(property, NO_COLOR)}</button><fieldset aria-label={sheetMessages.neutrals()} className="sheet-swatch-grid">{renderSwatches(GRAYSCALE_COLORS)}</fieldset><fieldset aria-label={sheetMessages.colors()} className="sheet-swatch-grid">{renderSwatches(STANDARD_HUE_COLORS)}</fieldset>{colorsInSheet.length > 0 &&
          <fieldset className="sheet-swatch-grid"><legend className="sheet-swatch-caption">{sheetMessages.colorsInThisSheet()}</legend>{renderSwatches(colorsInSheet)}</fieldset>}</div></TooltipGroup>;
}
export const swatchColorKey = (color: Color): string => JSON.stringify(color);
export const ARROW_KEY_FOCUS_STEPS = new Map<string, FocusStep>([
  ['ArrowLeft', [-1, 0]],
  ['ArrowRight', [1, 0]],
  ['ArrowUp', [0, -1]],
  ['ArrowDown', [0, 1]],
]);
export const SWATCHES_CLASS_NAME = 'sheet-swatches';
