import type { Color, Hue, Shade } from '@open-artifact/sheets-core';
export function colorKey(color: Color): string {
  switch (color.kind) {
    case 'standard':
      return `${color.hue} ${color.shade}`;
    case 'rgb':
      return color.hex;
    case 'none':
      return color.kind;
  }
}
export function colorsEqual(color: Color, otherColor: Color): boolean {
  if (color.kind === 'standard' && otherColor.kind === 'standard') return color.hue === otherColor.hue && color.shade === otherColor.shade;
  if (color.kind === 'rgb' && otherColor.kind === 'rgb') return color.hex === otherColor.hex;
  return color.kind === 'none' && otherColor.kind === 'none';
}
export const NO_COLOR = {
  kind: 'none',
} satisfies Color;
export const WHITE_COLOR = {
  kind: 'rgb',
  hex: '#ffffff',
} satisfies Color;
export const BLACK_COLOR = {
  kind: 'rgb',
  hex: '#000000',
} satisfies Color;
export const LIGHT_GRAY_COLOR = {
  kind: 'rgb',
  hex: '#f3f3f3',
} satisfies Color;
export const STANDARD_HUES: Hue[] = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'magenta'];
export const HUE_SHADES: Shade[] = [100, 200, 300, 400, 600];
export const GRAY_SHADES: Shade[] = [100, 200, 400, 600, 800];
export const GRAYSCALE_COLORS: Color[] = [
  WHITE_COLOR,
  LIGHT_GRAY_COLOR,
  ...GRAY_SHADES.map(
    (shade): Color => ({
      kind: 'standard',
      hue: 'gray',
      shade,
    }),
  ),
  BLACK_COLOR,
];
export const STANDARD_HUE_COLORS: Color[] = HUE_SHADES.flatMap(
  (shade) =>
    STANDARD_HUES.map(
      (hue): Color => ({
        kind: 'standard',
        hue,
        shade,
      }),
    ),
);
