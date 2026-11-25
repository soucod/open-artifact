import { Tabs } from '../kit/tabs.tsx';
import type { Color } from '@open-artifact/sheets-core';
import * as React from 'react';
import { scrollDeltaToReveal } from '../links/link-hover-card.tsx';
import { sampleNumberText } from '../i18n/format-labels.ts';
import type { ColorProperty } from '../i18n/format-labels.ts';
import type { ColorPickerChoices } from '../view/page-view.ts';
import { cellColorPair, fillColorPair, optionChipColors } from './cell-colors.ts';
import { GRAYSCALE_COLORS, colorsEqual, NO_COLOR } from '../model/colors.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { ColorSwatches } from './color-picker/swatches.tsx';
import { CustomColorPicker } from './color-picker/custom-color.tsx';
import type { ColorSample } from './color-picker/custom-color.tsx';
/** What the picked color is for: cells (with the color of their other part, text or fill), or a dropdown option's pill. */
export type WhatIsColored = { kind: 'cells'; otherColor: Color | null } | { kind: 'option'; label: string };
/** The tabs of the color picker. */
export type ColorPickerTab = 'standard' | 'custom';
export interface SheetColorPickerProps {
  property: ColorProperty;
  /** The color now, or null when the cells differ. */
  color: Color | null;
  whatIsColored: WhatIsColored;
  whatItShows: () => ColorPickerChoices;
  onChosen: (color: Color) => void;
  onDone: () => void;
}
export function scrollFocusedIntoPopup(element: Element, popup: Element | null) {
  let scroller: HTMLElement | null = popup === null ? null : element.parentElement;
  while (scroller !== null && scroller.scrollHeight <= scroller.clientHeight + 1) scroller = scroller === popup ? null : scroller.parentElement;
  if (scroller === null) return;
  let { top, bottom } = element.getBoundingClientRect();
  let scrollerBounds = scroller.getBoundingClientRect();
  let margin = Math.min(COLOR_FOCUS_SCROLL_MARGIN, (scrollerBounds.bottom - scrollerBounds.top - (bottom - top)) / 2);
  scroller.scrollTop += scrollDeltaToReveal(scrollerBounds, {
    top: top - margin,
    bottom: bottom + margin,
  });
}
export function SheetColorPicker(props: SheetColorPickerProps) {
  let {
    property,
    color,
    whatIsColored,
    whatItShows,
    onChosen,
    onDone,
  } = props;
  let { hexColorsInSheet, textOfActiveCell } = whatItShows();
  let cellSample = (otherColor: Color): ColorSample => ({
    shape: 'cell',
    text: textOfActiveCell === '' ? sampleNumberText() : textOfActiveCell,
    paintsWith: (sampleColor) => {
      let [fillColor, fontColor] = property === 'fillColor' ? [sampleColor, otherColor] : [otherColor, sampleColor];
      return cellColorPair(fillColor, fontColor);
    },
  });
  let isStandard =
    color?.kind !== 'rgb' || GRAYSCALE_COLORS.some((grayscale) => colorsEqual(color, grayscale)) || hexColorsInSheet.includes(color.hex);
  let [tab, setTab] = React.useState<ColorPickerTab>(isStandard ? 'standard' : 'custom');
  let isPointerFocusRef = React.useRef(false);
  return <Tabs.Root className="sheet-color-picker" value={tab} onValueChange={(chosenTab) => setTab(chosenTab)} onPointerDownCapture={() => {
      isPointerFocusRef.current = true;
    }} onKeyDownCapture={() => {
      isPointerFocusRef.current = false;
    }} onFocus={({ target }) => {
      if (isPointerFocusRef.current || !target.matches(':focus-visible')) return;
      let focused = target.closest('.sheet-color-square') ?? target;
      scrollFocusedIntoPopup(focused, target.closest('[role="dialog"]'));
    }}><Tabs.List aria-label={sheetMessages.kindsOfColor()} size="sm"><Tabs.Tab value="standard">{sheetMessages.standardColors()}</Tabs.Tab><Tabs.Tab value="custom">{sheetMessages.customColor()}</Tabs.Tab></Tabs.List><Tabs.Panel value="standard" tabIndex={-1}><ColorSwatches property={property} current={color} colorsInSheet={hexColorsInSheet.map(
            (hex): Color => ({
              kind: 'rgb',
              hex,
            }),
          )} onChosen={(chosen) => {
            onChosen(chosen);
            onDone();
          }} /></Tabs.Panel><Tabs.Panel value="custom" tabIndex={-1}><CustomColorPicker startsAt={(fillColorPair(color ?? NO_COLOR) ?? fillColorPair(DEFAULT_CUSTOM_COLOR))?.onLight ?? '#000000'} sample={whatIsColored.kind === 'cells'
              ? cellSample(whatIsColored.otherColor ?? NO_COLOR)
              : {
                  shape: 'pill',
                  text: whatIsColored.label,
                  paintsWith: optionChipColors,
                }} onChosen={onChosen} /></Tabs.Panel></Tabs.Root>;
}
export const COLOR_POPUP_PADDING = 'md';
export const DEFAULT_CUSTOM_COLOR: Color = {
  kind: 'standard',
  hue: 'blue',
  shade: 400,
};
export const COLOR_FOCUS_SCROLL_MARGIN = 32;
