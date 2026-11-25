import type { Color, Hue, Shade } from '@open-artifact/sheets-core';
import type { ChipPaints, PaintPair } from '../grid/cell-drawing.tsx';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { ColorProperty } from '../i18n/format-labels.ts';
import type { Oklch } from './color-space.ts';
import {
  hexToOklch,
  contrastRatio,
  hexAtLightness,
  rgbUnitToHex,
  oklchToSrgb,
  ACHROMATIC_CHROMA_LIMIT,
  maxChromaInGamut,
  relativeLuminance,
  hexToRgbUnit,
} from './color-space.ts';
import { colorKey, LIGHT_GRAY_COLOR, NO_COLOR } from '../model/colors.ts';
/** A palette shade: the ones a cell can be given, and the two between them used for dark pages. */
export type PaletteShade = Shade | 500 | 700;
/** A gray lightness on a light page and the lightness it maps to on a dark one. */
export interface LightnessAnchor {
  onLight: number;
  onDark: number;
}
/** A color in OKLab: lightness and the two color axes. */
export type Oklab = [lightness: number, a: number, b: number];
/** A stop of a color scale: where it lies, from 0 to 1, and its color. */
export interface ColorScaleStop {
  at: number;
  color: Color;
}
/** The step a value takes between two colors of a color scale, out of `COLOR_SCALE_STEP_COUNT`. */
export interface ColorScaleStep {
  from: Color;
  to: Color;
  step: number;
}
/** The fill and text color of a chip on one page. */
export type ChipFillAndText = [fill: string, text: string];
export function darkModeTextForRgb(hex: string): string {
  let oklch = hexToOklch(hex);
  let contrastOnLight = contrastRatio(hex, PAGE_BACKGROUND_COLORS.onLight);
  let low = hexToOklch(PAGE_BACKGROUND_COLORS.onDark).lightness;
  let high = 1;
  for (let step = 0; step < 16; step += 1) {
    let middle = (low + high) / 2;
    if (contrastRatio(hexAtLightness(oklch, middle), PAGE_BACKGROUND_COLORS.onDark) < contrastOnLight) low = middle;
    else high = middle;
  }
  return hexAtLightness(oklch, high);
}
export function standardFillColors(hue: Hue, shade: Shade): PaintPair {
  let [lowerDarkShade, upperDarkShade] = DARK_FILL_SHADES_FOR_SHADE[shade];
  let shades = CELL_COLOR_PALETTE[hue];
  return {
    onLight: shades[shade],
    onDark: lowerDarkShade === upperDarkShade ? shades[lowerDarkShade] : mixColorsInOklab(shades[lowerDarkShade], shades[upperDarkShade], 0.5),
  };
}
export function paletteSwatchesOfHue(hue: Hue): Record<Shade, string> {
  let swatchAt = (shade: Shade) => standardTextColors(hue, shade).onLight;
  return {
    100: swatchAt(100),
    200: swatchAt(200),
    300: swatchAt(300),
    400: swatchAt(400),
    600: swatchAt(600),
    800: swatchAt(800),
  };
}
export function listPaletteSwatches(): Record<Hue, Record<Shade, string>> {
  return {
    gray: paletteSwatchesOfHue('gray'),
    red: paletteSwatchesOfHue('red'),
    orange: paletteSwatchesOfHue('orange'),
    yellow: paletteSwatchesOfHue('yellow'),
    green: paletteSwatchesOfHue('green'),
    teal: paletteSwatchesOfHue('teal'),
    blue: paletteSwatchesOfHue('blue'),
    purple: paletteSwatchesOfHue('purple'),
    magenta: paletteSwatchesOfHue('magenta'),
  };
}
export function fillColorPair(color: Color): PaintPair | null {
  switch (color.kind) {
    case 'none':
      return null;
    case 'standard':
      return standardFillColors(color.hue, color.shade);
    case 'rgb':
      return {
        onLight: color.hex,
        onDark: darkFillForRgb(color.hex),
      };
  }
}
export function textColorPair(color: Color): PaintPair | null {
  switch (color.kind) {
    case 'none':
      return null;
    case 'standard':
      return standardTextColors(color.hue, color.shade);
    case 'rgb':
      return {
        onLight: color.hex,
        onDark: darkModeTextForRgb(color.hex),
      };
  }
}
export function lightenedFillColor(color: Color): Color | null {
  let hex = fillColorPair(color)?.onLight;
  if (hex === undefined) return null;
  let lightenChannel = (start: number) =>
    Math.round((Number.parseInt(hex.slice(start, start + 2), 16) + 255) / 2)
      .toString(16)
      .padStart(2, '0');
  return {
    kind: 'rgb',
    hex: `#${lightenChannel(1)}${lightenChannel(3)}${lightenChannel(5)}`,
  };
}
export function mapLightnessToDark(lightness: number, anchors: LightnessAnchor[] = TEXT_LIGHTNESS_MAP): number {
  let previous = PAGE_LIGHTNESS_ANCHOR;
  for (let anchor of anchors) {
    if (lightness > anchor.onLight) {
      let fraction = (previous.onLight - lightness) / (previous.onLight - anchor.onLight);
      return previous.onDark + fraction * (anchor.onDark - previous.onDark);
    }
    previous = anchor;
  }
  return previous.onDark;
}
export function capChromaToPalette(oklch: Oklch, lightness: number, shade: PaletteShade): string {
  let hex = hexAtLightness(oklch, lightness);
  let paletteChromas = Object.values(CELL_COLOR_PALETTE).map((swatches) => hexToOklch(swatches[shade]).chroma);
  let maxChroma = Math.max(oklch.chroma, ...paletteChromas);
  return hexToOklch(hex).chroma <= maxChroma
    ? hex
    : rgbUnitToHex(
        oklchToSrgb({
          ...oklch,
          lightness,
          chroma: maxChroma,
        }),
      );
}
export function darkFillForRgb(hex: string): string {
  let oklch = hexToOklch(hex);
  let darkLightness = mapLightnessToDark(oklch.lightness, FILL_LIGHTNESS_MAP);
  return capChromaToPalette(oklch, darkLightness, 500);
}
export function keepTextChromaOnDark(hex: string, darkHex: string): string {
  let { lightness, chroma, hue } = hexToOklch(hex);
  let darkOklch = hexToOklch(darkHex);
  if (contrastRatio(hex, PAGE_BACKGROUND_COLORS.onLight) < MIN_TEXT_CONTRAST || chroma < ACHROMATIC_CHROMA_LIMIT || darkOklch.chroma >= chroma)
    return darkHex;
  let floorLightness = mapLightnessToDark(lightness);
  let { lightness: darkLightness } = darkOklch;
  while (darkLightness > floorLightness && maxChromaInGamut(darkLightness, hue) < chroma)
    darkLightness = Math.max(floorLightness, darkLightness - LIGHTNESS_SEARCH_STEP);
  return rgbUnitToHex(
    oklchToSrgb({
      lightness: darkLightness,
      chroma: Math.min(chroma, maxChromaInGamut(darkLightness, hue)),
      hue,
    }),
  );
}
export function shiftLightnessForContrast(background: string, hex: string, minContrast: number): string | null {
  let oklch = hexToOklch(hex);
  for (let offset = LIGHTNESS_SEARCH_STEP; offset <= 1; offset += LIGHTNESS_SEARCH_STEP)
    for (let lightness of [oklch.lightness + offset, oklch.lightness - offset]) {
      if (lightness < 0 || lightness > 1) continue;
      let candidate = hexAtLightness(oklch, lightness);
      if (contrastRatio(candidate, background) >= minContrast) return candidate;
    }
  return null;
}
export function matchContrastOnDark(darkHex: string, lightHex: string, contrast: number): string {
  if (contrast < 1.01) return darkHex;
  let oklch = hexToOklch(lightHex);
  for (let { lightness } = hexToOklch(darkHex); lightness <= 1; lightness += LIGHTNESS_SEARCH_STEP) {
    let candidate = hexAtLightness(oklch, lightness);
    if (contrastRatio(candidate, darkHex) >= contrast) return candidate;
  }
  return hexAtLightness(oklch, 1);
}
export function defaultTextColorOn(background: string): string {
  let pageText = moreContrastingColor(background, PAGE_TEXT_COLORS.onLight, PAGE_TEXT_COLORS.onDark);
  return contrastRatio(pageText, background) >= MIN_TEXT_CONTRAST ? pageText : moreContrastingColor(background, '#000000', '#ffffff');
}
export function resolveTextColors(fontColor: Color, fill: PaintPair | null): PaintPair | null {
  if (fontColor.kind === 'none')
    return fill === null
      ? null
      : {
          onLight: defaultTextColorOn(fill.onLight),
          onDark: defaultTextColorOn(fill.onDark),
        };
  let textColors = textColorPair(fontColor);
  if (textColors === null) return null;
  let fillOrPage = fill ?? PAGE_BACKGROUND_COLORS;
  let contrastOnLight = contrastRatio(textColors.onLight, fillOrPage.onLight);
  if (contrastOnLight < MIN_TEXT_CONTRAST)
    return fill === null
      ? textColors
      : {
          onLight: textColors.onLight,
          onDark: matchContrastOnDark(fill.onDark, textColors.onLight, contrastOnLight),
        };
  let darkText = fontColor.kind === 'rgb' ? keepTextChromaOnDark(fontColor.hex, textColors.onDark) : textColors.onDark;
  return {
    onLight: textColors.onLight,
    onDark: ensureTextContrast(darkText, fillOrPage.onDark),
  };
}
export function cellColorsOfFormat(format: WholeCellFormat): ChipPaints {
  let cached = CELL_COLORS_CACHE.get(format);
  if (cached !== undefined) return cached;
  let colors = cellColorPair(format.fillColor, format.font.color);
  CELL_COLORS_CACHE.set(format, colors);
  return colors;
}
export function cellColorPair(fillColor: Color, fontColor: Color): ChipPaints {
  let [fill, text] = [fillColorPair(fillColor), textColorPair(fontColor)];
  if (
    !(
      fill !== null &&
      text !== null &&
      relativeLuminance(text.onLight) > relativeLuminance(fill.onLight) &&
      contrastRatio(text.onLight, fill.onLight) >= MIN_TEXT_CONTRAST
    )
  )
    return {
      fill,
      text: resolveTextColors(fontColor, fill),
    };
  let darkFill = darkFillUnderLightText(fillColor, fill.onLight);
  return {
    fill: {
      onLight: fill.onLight,
      onDark: darkFill,
    },
    text: {
      onLight: text.onLight,
      onDark: ensureTextContrast(text.onLight, darkFill),
    },
  };
}
export function darkFillUnderLightText(fillColor: Color, lightHex: string): string {
  if (fillColor.kind === 'standard' && fillColor.shade === 600) return CELL_COLOR_PALETTE[fillColor.hue][700];
  if (fillColor.kind === 'standard' && fillColor.shade === 800)
    return mixColorsInOklab(CELL_COLOR_PALETTE[fillColor.hue][700], CELL_COLOR_PALETTE[fillColor.hue][800], 0.5);
  let oklch = hexToOklch(lightHex);
  let darkLightness = mapLightnessToDark(oklch.lightness, INVERTED_FILL_LIGHTNESS_MAP);
  return capChromaToPalette(oklch, darkLightness, 700);
}
export function contrastingShade(hex: string): string {
  let cached = CONTRASTING_SHADE_CACHE.get(hex);
  if (cached !== undefined) return cached;
  let shade = shiftLightnessForContrast(hex, hex, MIN_TEXT_CONTRAST) ?? defaultTextColorOn(hex);
  CONTRASTING_SHADE_CACHE.set(hex, shade);
  return shade;
}
export function turnsChipsWhite({ fill, text }: ChipPaints): boolean {
  if (fill === null || text === null) return false;
  let [red, green, blue] = hexToRgbUnit(fill.onLight);
  let tintedFill = rgbUnitToHex([tintChannelTowardWhite(red), tintChannelTowardWhite(green), tintChannelTowardWhite(blue)]);
  return relativeLuminance(text.onLight) > relativeLuminance(fill.onLight) && contrastRatio(text.onLight, tintedFill) >= MIN_TEXT_CONTRAST;
}
export function mixColorsInOklab(fromHex: string, toHex: string, amount: number): string {
  let [[fromLightness, fromA, fromB], [toLightness, toA, toB]] = [hexToOklab(fromHex), hexToOklab(toHex)];
  let [mixedA, mixedB] = [interpolateNumber(fromA, toA, amount), interpolateNumber(fromB, toB, amount)];
  return rgbUnitToHex(
    oklchToSrgb({
      lightness: interpolateNumber(fromLightness, toLightness, amount),
      chroma: Math.hypot(mixedA, mixedB),
      hue: Math.atan2(mixedB, mixedA),
    }),
  );
}
export function colorScaleStepAt([firstStop, ...otherStops]: ColorScaleStop[], value: number): ColorScaleStep {
  let [lower, upper] = [firstStop, firstStop];
  for (let stop of otherStops) if ((([lower, upper] = [upper, stop]), value <= stop.at)) break;
  let fraction = upper.at === lower.at ? (value < lower.at ? 0 : 1) : (value - lower.at) / (upper.at - lower.at);
  let step = Math.round(Math.min(1, Math.max(0, fraction)) * COLOR_SCALE_STEP_COUNT);
  return {
    from: lower.color,
    to: upper.color,
    step,
  };
}
export function colorScaleCellColors({ from, to, step }: ColorScaleStep, fontColor: Color): ChipPaints {
  let key = [from, to, fontColor].map(colorKey).join('|') + `|${step}`;
  let cached = COLOR_SCALE_COLORS_CACHE.get(key);
  if (cached !== undefined) return cached;
  let [fromColors, toColors] = [fillColorPair(from) ?? PAGE_BACKGROUND_COLORS, fillColorPair(to) ?? PAGE_BACKGROUND_COLORS];
  let amount = step / COLOR_SCALE_STEP_COUNT;
  let fill: PaintPair = {
    onLight: mixColorsInOklab(fromColors.onLight, toColors.onLight, amount),
    onDark: mixColorsInOklab(fromColors.onDark, toColors.onDark, amount),
  };
  let colors = {
    fill,
    text: resolveTextColors(fontColor, fill),
  };
  COLOR_SCALE_COLORS_CACHE.set(key, colors);
  return colors;
}
export function chipTextColorOfHue(fill: string, hue: Hue | null): string {
  return (
    (hue === null
      ? shiftLightnessForContrast(fill, fill, CHIP_TEXT_MIN_CONTRAST)
      : Object.values(CELL_COLOR_PALETTE[hue])
          .filter((swatch) => contrastRatio(swatch, fill) >= CHIP_TEXT_MIN_CONTRAST)
          .reduce<string | null>(
            (best, swatch) => (best === null || contrastRatio(swatch, fill) < contrastRatio(best, fill) ? swatch : best),
            null,
          )) ?? defaultTextColorOn(fill)
  );
}
export function optionChipColors(color: Color): ChipPaints {
  let fill = fillColorPair(color);
  if (fill === null)
    return {
      fill,
      text: null,
    };
  let hue = color.kind === 'standard' ? color.hue : null;
  return {
    fill,
    text: {
      onLight: chipTextColorOfHue(fill.onLight, hue),
      onDark: chipTextColorOfHue(fill.onDark, hue),
    },
  };
}
export function cachedOptionChipColors(color: Color): ChipPaints {
  let key = colorKey(color);
  let cached = OPTION_CHIP_COLORS_CACHE.get(key);
  if (cached !== undefined) return cached;
  let colors = optionChipColors(color);
  OPTION_CHIP_COLORS_CACHE.set(key, colors);
  return colors;
}
export function mixHexToward(target: number, amount: number, hex: string): string {
  let [red, green, blue] = hexToRgbUnit(hex);
  return rgbUnitToHex([interpolateNumber(red, target, amount), interpolateNumber(green, target, amount), interpolateNumber(blue, target, amount)]);
}
export function chipColorsApartFromFill(
  cellFill: string,
  [chipFill, chipText]: ChipFillAndText,
  hue: Hue | null,
  edgeOf: (fill: string) => string,
  minDistance: number,
): ChipFillAndText {
  let cellOklab = hexToOklab(cellFill);
  let distanceFromCell = (hex: string) =>
    Math.hypot(...hexToOklab(hex).map((channel, index) => channel - (cellOklab[index] ?? 0)));
  let chipDistance = distanceFromCell(chipFill);
  if (chipDistance >= minDistance) return [chipFill, chipText];
  let isApartAlready = chipDistance >= MIN_CHIP_FILL_DISTANCE;
  let isApart = (hex: string) => distanceFromCell(hex) >= MIN_CHIP_FILL_DISTANCE && distanceFromCell(hex) > chipDistance;
  let withEdge = (fill: string) => [fill, edgeOf(fill)];
  let findShifted = (target: number, step: number) =>
    [1, 2, 3]
      .map((times) => mixHexToward(target, times * step, chipFill))
      .find((shifted) => withEdge(shifted).every(isApart)) ?? null;
  let isChipDarker = relativeLuminance(chipText) < relativeLuminance(chipFill);
  let textFor = (fill: string) => {
    let [shiftedFill, chipEdge] = [fill, edgeOf(fill)];
    let candidates = [chipText, chipTextColorOfHue(shiftedFill, hue), chipTextColorOfHue(chipEdge, hue), '#ffffff']
      .filter((text) => relativeLuminance(text) < relativeLuminance(fill) === isChipDarker)
      .filter((text) => hasTextContrast(text, shiftedFill));
    let fallbackText = isChipDarker || isApartAlready ? null : candidates[0];
    return candidates.find((text) => hasTextContrast(text, chipEdge)) ?? fallbackText ?? null;
  };
  let [darker, lighter] = [findShifted(0, CHIP_DARKEN_STEP), findShifted(1, CHIP_LIGHTEN_STEP)];
  for (let candidate of isChipDarker ? [darker, lighter] : [lighter, darker]) {
    let candidateText = candidate === null ? null : textFor(candidate);
    if (candidate !== null && candidateText !== null) return [candidate, candidateText];
  }
  if (isApartAlready) return [chipFill, chipText];
  let fallbackFill = lighter ?? darker ?? chipFill;
  return [fallbackFill, chipTextColorOfHue(fallbackFill, hue)];
}
export function dropdownChipColors(cellFill: PaintPair | null, optionColor: Color): ChipPaints {
  let chipColors = cachedOptionChipColors(optionColor);
  if (cellFill === null || chipColors.fill === null || chipColors.text === null) return chipColors;
  let key = [colorKey(optionColor), cellFill.onLight, cellFill.onDark].join('|');
  let cached = DROPDOWN_CHIP_COLORS_CACHE.get(key);
  if (cached !== undefined) return cached;
  let hue = optionColor.kind === 'standard' ? optionColor.hue : null;
  let [onLight, onDark] = [
    chipColorsApartFromFill(
      cellFill.onLight,
      [chipColors.fill.onLight, chipColors.text.onLight],
      hue,
      (hex) => mixHexToward(0, CHIP_EDGE_DARKEN_AMOUNT, hex),
      MIN_CHIP_FILL_DISTANCE,
    ),
    chipColorsApartFromFill(
      cellFill.onDark,
      [chipColors.fill.onDark, chipColors.text.onDark],
      hue,
      (hex) => mixHexToward(1, CHIP_EDGE_LIGHTEN_AMOUNT, hex),
      MIN_CHIP_FILL_DISTANCE_ON_DARK,
    ),
  ];
  let colors =
    onLight[0] === chipColors.fill.onLight && onDark[0] === chipColors.fill.onDark
      ? chipColors
      : {
          fill: {
            onLight: onLight[0],
            onDark: onDark[0],
          },
          text: {
            onLight: onLight[1],
            onDark: onDark[1],
          },
        };
  DROPDOWN_CHIP_COLORS_CACHE.set(key, colors);
  return colors;
}
export function setSwatchColors(color: Color): PaintPair {
  let hue = color.kind === 'standard' ? color.hue : 'gray';
  return {
    onLight: CELL_COLOR_PALETTE[hue][300],
    onDark: CELL_COLOR_PALETTE[hue][400],
  };
}
export const CELL_COLOR_PALETTE: Record<Hue, Record<PaletteShade, string>> = {
  gray: {
    100: '#e0e0e0',
    200: '#c2c2c2',
    300: '#a4a4a4',
    400: '#878787',
    500: '#6b6b6b',
    600: '#515151',
    700: '#383838',
    800: '#202020',
  },
  red: {
    100: '#fad6d6',
    200: '#f4abab',
    300: '#ec7e7e',
    400: '#e34948',
    500: '#b93535',
    600: '#8e2626',
    700: '#641919',
    800: '#3c0e0e',
  },
  orange: {
    100: '#f7d8cb',
    200: '#f4ae94',
    300: '#ec835a',
    400: '#d95926',
    500: '#ae461c',
    600: '#863311',
    700: '#5d230b',
    800: '#371407',
  },
  yellow: {
    100: '#f9dca4',
    200: '#fab219',
    300: '#db9300',
    400: '#b77700',
    500: '#945d00',
    600: '#734500',
    700: '#512e00',
    800: '#311a00',
  },
  green: {
    100: '#caeac7',
    200: '#91d68b',
    300: '#55bf50',
    400: '#0ca30c',
    500: '#008300',
    600: '#006300',
    700: '#074506',
    800: '#11260f',
  },
  teal: {
    100: '#bfebdb',
    200: '#7ad7b4',
    300: '#3bbd8c',
    400: '#199e70',
    500: '#0f7e5c',
    600: '#065f49',
    700: '#034235',
    800: '#022720',
  },
  blue: {
    100: '#cde2fb',
    200: '#9ec5f4',
    300: '#6da7ec',
    400: '#3987e5',
    500: '#256abf',
    600: '#184f95',
    700: '#0d366b',
    800: '#032042',
  },
  purple: {
    100: '#dfdbfd',
    200: '#bfb9f5',
    300: '#a096eb',
    400: '#8173e3',
    500: '#6250d6',
    600: '#4a3aa7',
    700: '#322777',
    800: '#1d1649',
  },
  magenta: {
    100: '#f9d4e2',
    200: '#f3a8c3',
    300: '#e87ba4',
    400: '#d55181',
    500: '#ad3d66',
    600: '#862a4c',
    700: '#5e1c34',
    800: '#390f1f',
  },
};
export const PAGE_BACKGROUND_COLORS: PaintPair = {
  onLight: '#ffffff',
  onDark: '#1a1a19',
};
export const PAGE_TEXT_COLORS: PaintPair = {
  onLight: '#0b0b0b',
  onDark: '#f0efec',
};
export const DARK_TEXT_SHADE_FOR_SHADE: Record<Shade, PaletteShade> = {
  100: 800,
  200: 700,
  300: 600,
  400: 500,
  600: 400,
  800: 100,
};
export const standardTextColors = (hue: Hue, shade: Shade): PaintPair => ({
  onLight: CELL_COLOR_PALETTE[hue][shade],
  onDark: CELL_COLOR_PALETTE[hue][DARK_TEXT_SHADE_FOR_SHADE[shade]],
});
export const DARK_FILL_SHADES_FOR_SHADE: Record<Shade, [lower: PaletteShade, upper: PaletteShade]> = {
  100: [700, 800],
  200: [700, 700],
  300: [600, 700],
  400: [600, 600],
  600: [500, 600],
  800: [500, 500],
};
export const MIN_TEXT_CONTRAST = 4.5;
export const LIGHTNESS_SEARCH_STEP = 0.005;
export const grayShadeLightness = (shade: PaletteShade): number => hexToOklch(CELL_COLOR_PALETTE.gray[shade]).lightness;
export const PAGE_LIGHTNESS_ANCHOR: LightnessAnchor = {
  onLight: 1,
  onDark: hexToOklch(PAGE_BACKGROUND_COLORS.onDark).lightness,
};
export const TEXT_LIGHTNESS_MAP: LightnessAnchor[] = [
  ...([100, 200, 300, 400, 600, 800] satisfies Shade[]).map(
    (shade) => ({
      onLight: grayShadeLightness(shade),
      onDark: grayShadeLightness(DARK_TEXT_SHADE_FOR_SHADE[shade]),
    }),
  ),
  {
    onLight: 0,
    onDark: 1,
  },
];
export const DARK_DEFAULT_FILL_HEX = '#252525';
export const FILL_LIGHTNESS_MAP: LightnessAnchor[] = [
  {
    onLight: hexToOklch(LIGHT_GRAY_COLOR.hex).lightness,
    onDark: hexToOklch(DARK_DEFAULT_FILL_HEX).lightness,
  },
  ...([100, 200, 300, 400, 600, 800] satisfies Shade[]).map((shade) => {
    let [lowerShade, upperShade] = DARK_FILL_SHADES_FOR_SHADE[shade];
    return {
      onLight: grayShadeLightness(shade),
      onDark: (grayShadeLightness(lowerShade) + grayShadeLightness(upperShade)) / 2,
    };
  }),
  {
    onLight: 0,
    onDark: grayShadeLightness(500),
  },
];
export const INVERTED_FILL_LIGHTNESS_MAP: LightnessAnchor[] = [
  {
    onLight: grayShadeLightness(300),
    onDark: (grayShadeLightness(600) + grayShadeLightness(700)) / 2,
  },
  {
    onLight: grayShadeLightness(600),
    onDark: grayShadeLightness(700),
  },
  {
    onLight: grayShadeLightness(800),
    onDark: (grayShadeLightness(700) + grayShadeLightness(800)) / 2,
  },
  {
    onLight: 0,
    onDark: (grayShadeLightness(700) + 3 * grayShadeLightness(800)) / 4,
  },
];
export const ensureTextContrast = (text: string, background: string): string =>
  contrastRatio(text, background) >= MIN_TEXT_CONTRAST ? text : (shiftLightnessForContrast(background, text, MIN_TEXT_CONTRAST) ?? text);
export const moreContrastingColor = (background: string, first: string, second: string): string =>
  contrastRatio(first, background) >= contrastRatio(second, background) ? first : second;
export const textColorsOnFill = (fontColor: Color, fillColor: Color): PaintPair | null =>
  resolveTextColors(fontColor, fillColorPair(fillColor));
export const shownCellColor = (property: ColorProperty, color: Color, otherColor: Color = NO_COLOR): PaintPair | null =>
  property === 'fillColor' ? cellColorPair(color, otherColor).fill : cellColorPair(otherColor, color).text;
export const NO_CELL_COLORS: ChipPaints = {
  fill: null,
  text: null,
};
export const CELL_COLORS_CACHE = new WeakMap<WholeCellFormat, ChipPaints>();
export const contrastingShades = (pair: PaintPair): PaintPair => ({
  onLight: contrastingShade(pair.onLight),
  onDark: contrastingShade(pair.onDark),
});
export const CONTRASTING_SHADE_CACHE = new Map<string, string>();
export const defaultTextColorsOnFill = (fill: PaintPair | null): PaintPair | null => resolveTextColors(NO_COLOR, fill);
export const CHIP_TINT_AMOUNT = 0.15;
export const tintChannelTowardWhite = (channel: number): number => interpolateNumber(channel, 1, CHIP_TINT_AMOUNT);
export const hexToOklab = (hex: string): Oklab => {
  let { lightness, chroma, hue } = hexToOklch(hex);
  return [lightness, chroma * Math.cos(hue), chroma * Math.sin(hue)];
};
export const interpolateNumber = (from: number, to: number, amount: number): number => from + (to - from) * amount;
export const COLOR_SCALE_STEP_COUNT = 32;
export const COLOR_SCALE_COLORS_CACHE = new Map<string, ChipPaints>();
export const CHIP_TEXT_MIN_CONTRAST = 5.5;
export const OPTION_CHIP_COLORS_CACHE = new Map<string, ChipPaints>();
export const MIN_CHIP_FILL_DISTANCE = 0.03;
export const MIN_CHIP_FILL_DISTANCE_ON_DARK = 0.065;
export const CHIP_DARKEN_STEP = 0.06;
export const CHIP_LIGHTEN_STEP = 0.1;
export const CHIP_EDGE_DARKEN_AMOUNT = 0.05;
export const CHIP_EDGE_LIGHTEN_AMOUNT = 0.075;
export const hasTextContrast = (text: string, background: string): boolean => contrastRatio(text, background) >= MIN_TEXT_CONTRAST;
export const DROPDOWN_CHIP_COLORS_CACHE = new Map<string, ChipPaints>();
