import { rgbUnitToHex, hexToRgbUnit } from './color-space.ts';
/** A color by hue (degrees), saturation and brightness (each 0–1), as the custom color picker edits it. */
export interface Hsb {
  hue: number;
  saturation: number;
  brightness: number;
}
export function hsbToHex({ hue, saturation, brightness }: Hsb): string {
  let channel = (offset: number) => {
    let sector = (offset + hue / 60) % 6;
    return brightness * (1 - saturation * Math.max(0, Math.min(sector, 4 - sector, 1)));
  };
  return rgbUnitToHex([channel(5), channel(3), channel(1)]);
}
export function hexToHsb(hex: string, fallbackHue: number): Hsb {
  let [red, green, blue] = hexToRgbUnit(hex);
  let most = Math.max(red, green, blue);
  let chroma = most - Math.min(red, green, blue);
  if (chroma === 0)
    return {
      hue: fallbackHue,
      saturation: 0,
      brightness: most,
    };
  return {
    hue: (most === red ? ((green - blue) / chroma + 6) % 6 : most === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4) * 60,
    saturation: chroma / most,
    brightness: most,
  };
}
export function normalizeHexColor(text: string): string | null {
  let digits = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim())?.[1]?.toLowerCase();
  if (digits === undefined) return null;
  return digits.length === 6 ? `#${digits}` : `#${digits.replaceAll(/./g, '$&$&')}`;
}
