/** A color in the OKLCH space: perceived lightness (0–1), chroma, and hue angle in radians. */
export interface Oklch {
  lightness: number;
  chroma: number;
  hue: number;
}
/** Red, green and blue, each from 0 to 1. */
export type RgbChannels = [red: number, green: number, blue: number];
export function hexToLinearRgb(hex: string): RgbChannels {
  let [red, green, blue] = hexToRgbUnit(hex);
  return [srgbToLinear(red), srgbToLinear(green), srgbToLinear(blue)];
}
export function hexToOklch(hex: string): Oklch {
  let [red, green, blue] = hexToLinearRgb(hex);
  let long = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  let medium = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  let short = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  let greenRed = 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short;
  let blueYellow = 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short;
  return {
    lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    chroma: Math.hypot(greenRed, blueYellow),
    hue: Math.atan2(blueYellow, greenRed),
  };
}
export function oklchToSrgb({ lightness, chroma, hue }: Oklch): RgbChannels {
  let greenRed = chroma * Math.cos(hue);
  let blueYellow = chroma * Math.sin(hue);
  let long = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  let medium = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  let short = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  return [
    linearToSrgb(4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short),
    linearToSrgb(-1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short),
    linearToSrgb(-0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short),
  ];
}
export function maxChromaInGamut(lightness: number, hue: number): number {
  let low = 0;
  let high = MAX_CHROMA_SEARCH_LIMIT;
  for (let step = 0; step < 12; step += 1) {
    let middle = (low + high) / 2;
    if (
      isOklchInSrgbGamut({
        lightness,
        chroma: middle,
        hue,
      })
    )
      low = middle;
    else high = middle;
  }
  return low;
}
export function hexAtLightness(oklch: Oklch, lightness: number): string {
  if (oklch.chroma < ACHROMATIC_CHROMA_LIMIT)
    return rgbUnitToHex(
      oklchToSrgb({
        lightness,
        chroma: 0,
        hue: 0,
      }),
    );
  let maxChromaNow = maxChromaInGamut(oklch.lightness, oklch.hue);
  let chroma = (maxChromaNow === 0 ? 0 : Math.min(1, oklch.chroma / maxChromaNow)) * maxChromaInGamut(lightness, oklch.hue);
  return rgbUnitToHex(
    oklchToSrgb({
      lightness,
      chroma,
      hue: oklch.hue,
    }),
  );
}
export function relativeLuminance(hex: string): number {
  let [red, green, blue] = hexToLinearRgb(hex);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}
export function contrastRatio(hexA: string, hexB: string): number {
  let [luminanceA, luminanceB] = [relativeLuminance(hexA), relativeLuminance(hexB)];
  return (Math.max(luminanceA, luminanceB) + 0.05) / (Math.min(luminanceA, luminanceB) + 0.05);
}
export const hexToRgbUnit = (hex: string): RgbChannels => {
  let rgb = Number.parseInt(hex.slice(1), 16);
  return [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255];
};
export const rgbUnitToHex = (channels: readonly number[]): string =>
  `#${channels
    .map(
      (channel) =>
        Math.round(Math.min(1, Math.max(0, channel)) * 255)
          .toString(16)
          .padStart(2, '0'),
    )
    .join('')}`;
export const srgbToLinear = (channel: number): number => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** 0.4166666666666667 - 0.055;
export const SRGB_GAMUT_EPSILON = 0.00196078431372549;
export const isOklchInSrgbGamut = (oklch: Oklch): boolean =>
  oklchToSrgb(oklch).every((channel) => channel >= -SRGB_GAMUT_EPSILON && channel <= 1 + SRGB_GAMUT_EPSILON);
export const MAX_CHROMA_SEARCH_LIMIT = 0.4;
export const ACHROMATIC_CHROMA_LIMIT = 0.012;
