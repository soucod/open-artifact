import type { Color, Hue, Shade } from '@open-artifact/sheets-core';
import { NO_COLOR, colorsEqual } from '../model/colors.ts';
/** A hue a label calls for, or `none` for a label that calls for no color at all. */
export type HueOfLabel = Hue | 'none';
/** An option's label and the color its chip is drawn in. */
export interface ColoredOption {
  label: string;
  color: Color;
}
export function hueNamedByLabel(label: string, isHueFree: (hue: Hue) => boolean): HueOfLabel | null {
  let negationAt = label.search(NEGATION_PATTERN);
  let best: { hue: HueOfLabel; at: number } | null = null;
  for (let [hue, pattern] of STATUS_HUE_PATTERNS) {
    let matchAt = label.search(pattern);
    let isAllowed = hue === 'none' || (isHueFree(hue) && (negationAt === -1 || matchAt < negationAt));
    if (matchAt !== -1 && isAllowed && (best === null || matchAt < best.at))
      best = {
        hue,
        at: matchAt,
      };
  }
  return best?.hue ?? null;
}
export function colorSuggestedByLabel(label: string, takenColors: readonly Color[]): Color | null {
  let takenHues = standardHuesOf(takenColors);
  let hue = hueNamedByLabel(label, (freeHue) => !takenHues.includes(freeHue));
  if (hue === null) return null;
  return hue === 'none'
    ? NO_COLOR
    : {
        kind: 'standard',
        hue,
        shade: DROPDOWN_CHIP_SHADE,
      };
}
export function colorForNewOption(label: string, takenColors: readonly Color[]): Color {
  let suggested = colorSuggestedByLabel(label, takenColors);
  if (suggested !== null) return suggested;
  let takenHues = standardHuesOf(takenColors);
  let timesTaken = (hue: Hue | undefined) => takenHues.filter((taken) => taken === hue).length;
  let takenWeight = (hue: Hue) => timesTaken(hue) + (timesTaken(HUES_ALIKE[hue]) > 0 ? 0.5 : 0);
  let leastTakenHue = DROPDOWN_HUES.reduce((best, hue) => (takenWeight(hue) < takenWeight(best) ? hue : best));
  let colorOfShade = (shade: Shade): Color => ({
    kind: 'standard',
    hue: leastTakenHue,
    shade,
  });
  let freeShade = DROPDOWN_SHADES.find(
    (shade) => !takenColors.some((color) => colorsEqual(colorOfShade(shade), color)),
  );
  return colorOfShade(freeShade ?? DROPDOWN_CHIP_SHADE);
}
export function colorOptionsAutomatically<Option extends { label: string }>(options: readonly Option[]): (Option & { color: Color })[] {
  let colored = assignOptionColors(options);
  return colored.filter(({ color }) => color.kind !== 'none').length > DROPDOWN_HUES.length
    ? withoutOptionColors(options)
    : colored;
}
export function assignOptionColors<Option extends { label: string }>(
  options: readonly Option[],
  keptColorOf: (option: Option) => Color | undefined = (): undefined => {
    return;
  },
): (Option & { color: Color })[] {
  let colorByOption = new Map<Option, Color>();
  for (let option of options) {
    let keptColor = keptColorOf(option);
    if (keptColor !== undefined) colorByOption.set(option, keptColor);
  }
  for (let option of options) {
    let keptColors = [...colorByOption.values()];
    if (!colorByOption.has(option) && colorSuggestedByLabel(option.label, keptColors) !== null)
      colorByOption.set(option, colorForNewOption(option.label, keptColors));
  }
  let usedColors = [...colorByOption.values()];
  return options.map((option) => {
    let kept = colorByOption.get(option);
    let color = kept ?? colorForNewOption(option.label, usedColors);
    if (kept === undefined) usedColors.push(color);
    return {
      ...option,
      color,
    };
  });
}
export const DROPDOWN_HUES: Hue[] = ['blue', 'orange', 'teal', 'yellow', 'magenta', 'green', 'purple', 'red'];
export const DROPDOWN_CHIP_SHADE = 200 satisfies Shade;
export const DROPDOWN_COLOR_CHOICES: Color[] = [
  NO_COLOR,
  ...(['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'magenta'] satisfies Hue[]).map(
    (hue): Color => ({
      kind: 'standard',
      hue,
      shade: DROPDOWN_CHIP_SHADE,
    }),
  ),
];
export const DROPDOWN_SHADES: Shade[] = [DROPDOWN_CHIP_SHADE, 300];
export const wholeWordPattern = (words: string): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words})(?![\\p{L}\\p{N}])`, 'iu');
export const DONE_STATUS_WORDS = 'done|completed?|shipped|approved|accepted|resolved|live|launched|pass(?:ed|ing)?|paid|on[ -]track|yes';
export const BLOCKED_STATUS_WORDS = 'blocke(?:d|rs?)|stuck';
export const STATUS_HUE_PATTERNS: [HueOfLabel, RegExp][] = [
  ['none', wholeWordPattern('not[ -]started|backlog|to[ -]?do|icebox|idea|unassigned|none')],
  ['green', wholeWordPattern(DONE_STATUS_WORDS)],
  ['blue', wholeWordPattern('progress|doing|review|active|building|drafting|underway|started')],
  [
    'red',
    wholeWordPattern(
      `${BLOCKED_STATUS_WORDS}|risk|late|overdue|bug|fail(?:ed|ing|ure)?|reject(?:ed)?|declined?|off[ -]track|urgent|critical|high|no`,
    ),
  ],
  ['purple', wholeWordPattern('review|pending|waiting|qa|needs input|proposed')],
  ['teal', wholeWordPattern(`low|nice to have|someday|${DONE_STATUS_WORDS}`)],
  ['yellow', wholeWordPattern(`at[ -]risk|${BLOCKED_STATUS_WORDS}|med(?:ium)?|maybe|normal|plann(?:ed|ing)|next|scheduled|unpaid`)],
  ['magenta', wholeWordPattern('cancell?ed|archived|dropped|on hold|paused')],
];
export const NEGATION_PATTERN = wholeWordPattern('(?:not|no|part|partly|partially|half|almost|nearly)(?=[^\\p{L}\\p{N}]+[\\p{L}\\p{N}])');
export const standardHuesOf = (colors: readonly Color[]): Hue[] =>
  colors.flatMap((color) => (color.kind === 'standard' ? [color.hue] : []));
export const HUES_ALIKE: Partial<Record<Hue, Hue>> = {
  orange: 'red',
};
export const isDropdownDeliberatelyUncolored = (options: readonly ColoredOption[]): boolean =>
  options.every(({ color }) => color.kind === 'none') &&
  options.some(({ label }) => colorSuggestedByLabel(label, [])?.kind !== 'none');
export const colorForAddedOption = (label: string, options: readonly ColoredOption[]): Color =>
  isDropdownDeliberatelyUncolored(options)
    ? NO_COLOR
    : colorForNewOption(
        label,
        options.map(({ color }) => color),
      );
export const withoutOptionColors = <Option extends { label: string }>(options: readonly Option[]): (Option & { color: Color })[] =>
  options.map(
    (option) => ({
      ...option,
      color: NO_COLOR,
    }),
  );
