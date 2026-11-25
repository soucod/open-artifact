import { Button } from '../kit/button.tsx';
import * as React from 'react';
import type { Color, SharedCellFormat } from '@open-artifact/sheets-core';
import type { ExamplesOfNumberFormats } from '../state/initial-state.ts';
import type { FormatCommand } from '../format/format-commands.ts';
import type { NumberFormatChoice, NumberFormatOrControlChoice } from '../format/number-format-choices.ts';
import type { ColorProperty } from '../i18n/format-labels.ts';
import type { TooltipSide } from '../kit/tooltip.tsx';
import { BarIconButton, BarSeparator } from './bar-buttons.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { FONT_SIZE_CHOICES, VERTICAL_ALIGN_CHOICES } from '../format/toolbar-size-choices.ts';
import { HORIZONTAL_ALIGNMENTS } from '../format/toolbar-choices.ts';
import { HORIZONTAL_ALIGN_ICONS, VERTICAL_ALIGN_ICONS, isWrapTextOn, wrapTextToggled } from './toolbar/text-menus.tsx';
import { horizontalAlignmentLabel, verticalAlignmentLabel, cellColorName } from '../i18n/format-labels.ts';
import { numberFormatExampleLabel } from '../i18n/menu-labels.ts';
import { exampleOfChoice } from '../format/number-format-choices.ts';
import { colorsEqual, STANDARD_HUE_COLORS, NO_COLOR, BLACK_COLOR } from '../model/colors.ts';
import { fillPaintStyle } from '../grid/cell-drawing.tsx';
import { shownCellColor } from '../format/cell-colors.ts';
/** A menu of the bar whose choices can show in the row of tools in its place. */
export type DockedBarChoice = 'align' | 'fontSize' | 'numberFormat' | 'textColor' | 'fillColor';
export interface DockedBarChoicesProps {
  of: DockedBarChoice;
  shared: SharedCellFormat;
  numberFormatOfSelection: NumberFormatOrControlChoice | null;
  examplesOfNumberFormats: ExamplesOfNumberFormats;
  onChosen: (command: FormatCommand) => void;
  onBack: () => void;
  onAllAsked: () => void;
  /** Called when the choices leave the row. */
  onGoing: () => void;
}
export function DockedBarChoices({
  of,
  shared,
  numberFormatOfSelection,
  examplesOfNumberFormats,
  onChosen,
  onBack,
  onAllAsked,
  onGoing,
}: DockedBarChoicesProps) {
  React.useLayoutEffect(() => onGoing, [onGoing]);
  let currentColor = of === 'fillColor' ? shared.fillColor : shared.font.color;
  return <><span className="sheet-back-in-docked-bar"><BarIconButton {...DOCKED_TOOL_PROPS} icon="CaretLeft" label={sheetMessages.backToTools()} onClick={onBack} /></span>{of === 'fontSize' &&
        FONT_SIZE_CHOICES.map(
          (size) =>
            (<Button key={size} variant="ghost" pressed={shared.font.size === size} onClick={() =>
                  onChosen({
                    fontSizeInPoints: size,
                  })}><span className="tabular-nums">{size}</span></Button>),
        )}{of === 'align' &&
        (<>{HORIZONTAL_ALIGNMENTS.map(
              (alignment) =>
                (<BarIconButton key={alignment} {...DOCKED_TOOL_PROPS} icon={HORIZONTAL_ALIGN_ICONS[alignment]} label={horizontalAlignmentLabel(alignment)} pressed={shared.alignment.horizontal === alignment} onClick={() =>
                      onChosen({
                        horizontalAlignment: alignment,
                      })} />),
            )}<BarSeparator />{VERTICAL_ALIGN_CHOICES.map(
              (alignment) =>
                (<BarIconButton key={alignment} {...DOCKED_TOOL_PROPS} icon={VERTICAL_ALIGN_ICONS[alignment]} label={verticalAlignmentLabel(alignment)} pressed={shared.alignment.vertical === alignment} onClick={() =>
                      onChosen({
                        verticalAlignment: alignment,
                      })} />),
            )}<BarSeparator /><BarIconButton {...DOCKED_TOOL_PROPS} icon="TextWrap" label={sheetMessages.wrapText()} pressed={isWrapTextOn(shared)} onClick={() => onChosen(wrapTextToggled(shared))} /></>)}{of === 'numberFormat' &&
        DOCKED_NUMBER_FORMATS.map(
          (format) =>
            (<Button key={format} variant="ghost" aria-label={numberFormatExampleLabel(format, exampleOfChoice(examplesOfNumberFormats, format))} pressed={numberFormatOfSelection === format} onClick={() =>
                  onChosen({
                    numberFormatChoice: format,
                  })}><span className="tabular-nums">{exampleOfChoice(examplesOfNumberFormats, format)}</span></Button>),
        )}{(of === 'textColor' || of === 'fillColor') &&
        DOCKED_COLORS[of].map(
          (color) =>
            (<button key={JSON.stringify(color)} type="button" className="sheet-swatch sheet-swatch-in-docked-bar" aria-label={cellColorName(of, color)} aria-pressed={currentColor !== null && colorsEqual(currentColor, color)} data-has-fill={color.kind !== 'none' || undefined} style={fillPaintStyle(shownCellColor(of, color))} onClick={() =>
                  onChosen(
                    of === 'fillColor'
                      ? {
                          fillColor: color,
                        }
                      : {
                          textColor: color,
                        },
                  )} />),
        )}{of !== 'fontSize' &&
        of !== 'align' &&
        <><BarSeparator /><Button variant="ghost" aria-label={DOCKED_ALL_CHOICES_LABELS[of]()} onClick={onAllAsked}>{sheetMessages.allChoices()}</Button></>}</>;
}
export const DOCKED_BAR_CHOICES: readonly DockedBarChoice[] = ['align', 'fontSize', 'numberFormat', 'textColor', 'fillColor'];
export const isDockedBarChoice = (choice: string | null): choice is DockedBarChoice =>
  choice !== null && (DOCKED_BAR_CHOICES as readonly string[]).includes(choice);
export const DOCKED_NUMBER_FORMATS: readonly NumberFormatChoice[] = ['general', 'number', 'currency', 'percent', 'date', 'time'];
export const standardColorsOfShade = (shade: number): Color[] =>
  STANDARD_HUE_COLORS.filter((color) => color.kind === 'standard' && color.shade === shade);
export const DOCKED_COLORS: Record<ColorProperty, Color[]> = {
  textColor: [
    NO_COLOR,
    BLACK_COLOR,
    {
      kind: 'standard',
      hue: 'gray',
      shade: 600,
    },
    ...standardColorsOfShade(600),
  ],
  fillColor: [
    NO_COLOR,
    {
      kind: 'standard',
      hue: 'gray',
      shade: 100,
    },
    ...standardColorsOfShade(100),
  ],
};
export const DOCKED_TOOL_PROPS: { tooltipSide: TooltipSide; whyNot: null } = {
  tooltipSide: 'top',
  whyNot: null,
};
export const DOCKED_ALL_CHOICES_LABELS: Record<Exclude<DockedBarChoice, 'align' | 'fontSize'>, () => string> = {
  numberFormat: sheetMessages.allNumberFormats,
  textColor: sheetMessages.allTextColors,
  fillColor: sheetMessages.allCellColors,
};
