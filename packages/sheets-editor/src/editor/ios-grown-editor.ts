import { fontPointsToPixels, nextLineHeight } from '../grid/cell-metrics-values.ts';
import { entryFontStyle } from '../grid/cell-drawing.tsx';
import type { CellFont } from '../grid/cell-drawing.tsx';
/** Where the entry box stands and how it is laid out, in pixels, before it is grown on iOS. */
export interface EntryBoxStyle {
  left: number;
  top: number;
  width?: number;
  height?: number;
  minWidth?: number;
  maxWidth?: number;
  paddingTop?: number;
  paddingBottom?: number;
  clipPath?: string;
  lineHeightInPixels?: number;
  '--sheet-clear-left-of-text'?: string;
  '--sheet-clear-right-of-text'?: string;
  '--sheet-entry-scale'?: string;
}
export function entryEditorStyle(
  { left: boxLeft, top: boxTop, lineHeightInPixels, ...box }: EntryBoxStyle,
  format: CellFont,
  isFormula: boolean,
) {
  let fontPixels = fontPointsToPixels(format.size);
  let lineHeight = lineHeightInPixels ?? nextLineHeight(format.size);
  let iosGrowth = IOS_UNZOOMED_FONT_SIZE / fontPixels;
  if (iosGrowth <= 1)
    return {
      left: boxLeft,
      top: boxTop,
      ...box,
      ...entryFontStyle(format, isFormula),
      lineHeight: `${lineHeight}px`,
    };
  return {
    left: boxLeft,
    top: boxTop,
    ...entryFontStyle(format, isFormula),
    height: grownEditorPixels(box.height),
    minWidth: grownEditorPixels(box.minWidth),
    maxWidth: grownEditorPixels(box.maxWidth),
    paddingTop: grownEditorPixels(box.paddingTop),
    paddingBottom: grownEditorPixels(box.paddingBottom),
    clipPath: box.clipPath?.replace(PIXEL_LENGTH_PATTERN, (match: string, pixels: string) => grownEditorPixels(Number(pixels)) ?? ''),
    fontSize: grownEditorPixels(fontPixels),
    lineHeight: grownEditorPixels(lineHeight),
    '--sheet-editor-grown-on-ios': String(iosGrowth),
    ...(box['--sheet-clear-left-of-text'] !== undefined && {
      '--sheet-clear-left-of-text': box['--sheet-clear-left-of-text'],
    }),
    ...(box['--sheet-clear-right-of-text'] !== undefined && {
      '--sheet-clear-right-of-text': box['--sheet-clear-right-of-text'],
    }),
    ...(box['--sheet-entry-scale'] !== undefined && {
      '--sheet-entry-scale': box['--sheet-entry-scale'],
    }),
  };
}
export function entryEditorLineStyle(lineHeight: number, format: CellFont) {
  let {
    left: droppedLeft,
    top: droppedTop,
    ...lineStyle
  } = entryEditorStyle(
    {
      left: 0,
      top: 0,
      height: lineHeight,
      lineHeightInPixels: lineHeight,
    },
    format,
    false,
  );
  return lineStyle;
}
export const IOS_UNZOOMED_FONT_SIZE = 16;
export const grownEditorPixels = (pixels: number | undefined): string | undefined =>
  pixels === undefined ? undefined : `calc(${pixels}px * var(--sheet-editor-grown, 1))`;
export const PIXEL_LENGTH_PATTERN = /(-?[\d.]+)px/g;
