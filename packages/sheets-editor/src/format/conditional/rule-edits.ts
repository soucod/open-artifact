import type {
  CellCondition,
  Color,
  ColumnId,
  ColumnOfRecords,
  Effect,
  FontOfACondition,
  FormatOfACondition,
  HighestAnchor,
  Hue,
  LowestAnchor,
  MiddleAnchor,
  RangeCorners,
  RuleInIds,
  Shade,
  Stop,
  Test,
  TestedCell,
} from '@open-artifact/sheets-core';
import { testedColumnOf, firstColumnOfRule, findColumnStats, defaultConditionForColumn } from './conditions.ts';
import type { ColumnStats } from './conditions.ts';
import { NO_COLOR } from '../../model/colors.ts';
import { measureOfColumn } from '../../words/column-holds.ts';
import type { FontMark } from '../../state/initial-state.ts';
import type { ColorProperty } from '../../i18n/format-labels.ts';
import type { RulePreset, ScaleAnchorKind, ScaleStop } from '../../messages/conditional-format.ts';
export type FormatWhereEffect = Extract<Effect, { kind: 'formatWhere' }>;
export type ColorScaleEffect = Extract<Effect, { kind: 'colorScale' }>;
export type StandardColor = Extract<Color, { kind: 'standard' }>;
export type ScaleAnchor = LowestAnchor | MiddleAnchor | HighestAnchor;
export interface FormatWhereRule extends RuleInIds {
  effect: FormatWhereEffect;
}
export interface ColorScaleRule extends RuleInIds {
  effect: ColorScaleEffect;
}
export interface RuleFormatPreset {
  key: RulePreset;
  format: FormatOfACondition;
}
export interface SuggestedRules {
  scale: ColorScaleRule;
  ofNegatives: FormatWhereRule;
  ofTheLargest: FormatWhereRule;
  ofAnyNumber: FormatWhereRule;
}
export function rangesNarrowedToColumn({ ranges: [firstRange, ...moreRanges] }: Pick<RuleInIds, 'ranges'>, c: ColumnId): RangeCorners[] {
  let toColumn = ({ topLeft, bottomRight }: RangeCorners): RangeCorners => ({
    topLeft: {
      r: topLeft.r,
      c,
    },
    bottomRight: {
      r: bottomRight.r,
      c,
    },
  });
  return [toColumn(firstRange), ...moreRanges.map(toColumn)];
}
export function updateRuleTest(effect: FormatWhereEffect, testIndex: number, update: (test: Test) => Test): FormatWhereEffect {
  let [firstTest, ...moreTests] = effect.allOf.map(
    (test, index) => (index === testIndex ? update(test) : test),
  );
  return firstTest === undefined
    ? effect
    : {
        ...effect,
        allOf: [firstTest, ...moreTests],
      };
}
export function removeRuleTest(effect: FormatWhereEffect, testIndex: number): FormatWhereEffect {
  let [firstTest, ...moreTests] = effect.allOf.filter((test, index) => index !== testIndex);
  return firstTest === undefined
    ? effect
    : {
        ...effect,
        allOf: [firstTest, ...moreTests],
      };
}
export function testOfUnusedColumn(rule: FormatWhereRule, columnStats: ColumnStats): TestedCell {
  let testedColumns = new Set<ColumnId | null>(
    rule.effect.allOf.map((test) => testedColumnOf(test, firstColumnOfRule(rule))),
  );
  return {
    kind: 'sameRowInColumn',
    c: (columnStats.columns.find(({ c }) => !testedColumns.has(c)) ?? columnStats.columns[0]).c,
  };
}
export function withRuleFont(format: FormatOfACondition, font: FontOfACondition): FormatOfACondition {
  let { font: oldFont, ...rest } = format;
  return Object.keys(font).length === 0
    ? rest
    : {
        ...rest,
        font,
      };
}
export function withFormatColor(format: FormatOfACondition, target: ColorProperty, color: Color): FormatOfACondition {
  if (target === 'fillColor') {
    let { fillColor: oldFill, ...rest } = format;
    return color.kind === 'none'
      ? rest
      : {
          ...rest,
          fillColor: color,
        };
  }
  let { color: oldColor, ...otherFont } = format.font ?? {};
  return withRuleFont(
    format,
    color.kind === 'none'
      ? otherFont
      : {
          ...otherFont,
          color,
        },
  );
}
export function isFontStyleOn({ font }: FormatOfACondition, style: FontMark): boolean {
  let value = font?.[style];
  return value !== undefined && value !== false && value !== 'none';
}
export function toggleFontStyle(format: FormatOfACondition, style: FontMark): FormatOfACondition {
  let { [style]: oldValue, ...otherFont } = format.font ?? {};
  if (isFontStyleOn(format, style)) return withRuleFont(format, otherFont);
  return withRuleFont(format, {
    ...otherFont,
    [style]: style === 'underline' ? 'single' : true,
  });
}
export function withScalePointColor(scale: ColorScaleEffect, point: ScaleStop, color: Color): ColorScaleEffect {
  if (point === 'middle')
    return scale.middle === null
      ? scale
      : {
          ...scale,
          middle: {
            ...scale.middle,
            color,
          },
        };
  return {
    ...scale,
    [point]: {
      ...scale[point],
      color,
    },
  };
}
export function withScalePointAnchor(
  scale: ColorScaleEffect,
  point: ScaleStop,
  anchorKind: ScaleAnchorKind,
  number: number,
): ColorScaleEffect {
  let anchor: MiddleAnchor =
    anchorKind === 'number'
      ? {
          kind: 'number',
          number,
        }
      : {
          kind: 'percentile',
          percentile: point === 'lowest' ? 0 : point === 'highest' ? 100 : MIDPOINT_PERCENTILE,
        };
  switch (point) {
    case 'lowest':
      return {
        ...scale,
        lowest: {
          ...scale.lowest,
          anchor:
            anchorKind === 'end'
              ? {
                  kind: 'smallestNumber',
                }
              : anchor,
        },
      };
    case 'highest':
      return {
        ...scale,
        highest: {
          ...scale.highest,
          anchor:
            anchorKind === 'end'
              ? {
                  kind: 'largestNumber',
                }
              : anchor,
        },
      };
    case 'middle':
      return scale.middle === null || anchorKind === 'end'
        ? scale
        : {
            ...scale,
            middle: {
              ...scale.middle,
              anchor,
            },
          };
  }
}
export function orderScaleAnchors(scale: ColorScaleEffect): ColorScaleEffect | null {
  let anchors: (ScaleAnchor | undefined)[] = [scale.lowest.anchor, scale.middle?.anchor, scale.highest.anchor];
  let numbers = sortedNumbers(anchors.flatMap((anchor) => (anchor?.kind === 'number' ? [anchor.number] : [])));
  let percentiles = sortedNumbers(
    anchors.flatMap((anchor) => (anchor?.kind === 'percentile' ? [anchor.percentile] : [])),
  );
  if (hasRepeatedNeighbor(numbers) || hasRepeatedNeighbor(percentiles)) return null;
  let orderedAnchor = <A extends ScaleAnchor>(anchor: A, earlierAnchors: (ScaleAnchor | undefined)[]): A | MiddleAnchor => {
    let rank = earlierAnchors.filter((earlier) => earlier?.kind === anchor.kind).length;
    if (anchor.kind === 'number')
      return {
        kind: 'number',
        number: numbers[rank] ?? anchor.number,
      };
    if (anchor.kind === 'percentile')
      return {
        kind: 'percentile',
        percentile: percentiles[rank] ?? anchor.percentile,
      };
    return anchor;
  };
  let { lowest, middle, highest } = scale;
  return {
    ...scale,
    lowest: {
      ...lowest,
      anchor: orderedAnchor(lowest.anchor, []),
    },
    middle:
      middle === null
        ? null
        : {
            ...middle,
            anchor: orderedAnchor(middle.anchor, [lowest.anchor]),
          },
    highest: {
      ...highest,
      anchor: orderedAnchor(highest.anchor, [lowest.anchor, middle?.anchor]),
    },
  };
}
export function columnForColorScale(rule: RuleInIds, columnStats: ColumnStats): ColumnId {
  let c = testedColumnOfRule(rule);
  let column = findColumnStats(columnStats, c);
  return column !== null && isScaleColumn(column) ? c : (columnStats.columns.find(isScaleColumn)?.c ?? c);
}
export function ruleWithEffectKind(
  rule: RuleInIds,
  effectKind: Effect['kind'],
  columnStats: ColumnStats,
): FormatWhereRule | ColorScaleRule | null {
  if (rule.effect.kind === effectKind) return null;
  let [{ topLeft, bottomRight }, ...moreRanges] = rule.ranges;
  let isOneRowRange = moreRanges.length === 0 && topLeft.r === bottomRight.r && topLeft.c !== bottomRight.c;
  if (effectKind === 'colorScale')
    return {
      ranges: isOneRowRange ? rule.ranges : rangesNarrowedToColumn(rule, columnForColorScale(rule, columnStats)),
      effect: DEFAULT_COLOR_SCALE,
    };
  let column = findColumnStats(columnStats, firstColumnOfRule(rule)) ?? columnStats.columns[0];
  return {
    ranges: isOneRowRange ? rule.ranges : rangesNarrowedToColumn(rule, column.c),
    effect: {
      kind: effectKind,
      allOf: [
        {
          tested: {
            kind: 'theCellItself',
          },
          condition: defaultConditionForColumn(column),
        },
      ],
      format: tintFormatOf('yellow'),
    },
  };
}
export const NEW_TEST_INDEX = -1;
export const withAddedTest = (effect: FormatWhereEffect, test: Test): FormatWhereEffect => ({
  ...effect,
  allOf: [...effect.allOf, test],
});
export const standardColorOf = (hue: Hue, shade: Shade): StandardColor => ({
  kind: 'standard',
  hue,
  shade,
});
export const tintFormatOf = (hue: Hue): FormatOfACondition => ({
  fillColor: standardColorOf(hue, 100),
  font: {
    color: standardColorOf(hue, 800),
  },
});
export const RULE_FORMAT_PRESETS: readonly RuleFormatPreset[] = [
  {
    key: 'red',
    format: tintFormatOf('red'),
  },
  {
    key: 'yellow',
    format: tintFormatOf('yellow'),
  },
  {
    key: 'green',
    format: tintFormatOf('green'),
  },
  {
    key: 'blue',
    format: tintFormatOf('blue'),
  },
  {
    key: 'grayStruckThrough',
    format: {
      font: {
        color: standardColorOf('gray', 600),
        strikethrough: true,
      },
    },
  },
  {
    key: 'bold',
    format: {
      font: {
        bold: true,
      },
    },
  },
];
export const defaultRuleForRanges = (ranges: RangeCorners[]): FormatWhereRule => ({
  ranges,
  effect: {
    kind: 'formatWhere',
    allOf: [
      {
        tested: {
          kind: 'theCellItself',
        },
        condition: {
          kind: 'isNotBlank',
        },
      },
    ],
    format: tintFormatOf('yellow'),
  },
});
export const ruleOfCellCondition = (ranges: RangeCorners[], condition: CellCondition, format: FormatOfACondition): FormatWhereRule => ({
  ranges,
  effect: {
    kind: 'formatWhere',
    allOf: [
      {
        tested: {
          kind: 'theCellItself',
        },
        condition,
      },
    ],
    format,
  },
});
export const suggestedRulesFor = (ranges: RangeCorners[]): SuggestedRules => ({
  scale: {
    ranges,
    effect: DEFAULT_COLOR_SCALE,
  },
  ofNegatives: ruleOfCellCondition(
    ranges,
    {
      kind: 'numberIs',
      comparison: 'lessThan',
      operand: {
        kind: 'number',
        number: 0,
      },
    },
    tintFormatOf('red'),
  ),
  ofTheLargest: ruleOfCellCondition(
    ranges,
    {
      kind: 'isAmongTheLargest',
      count: 1,
    },
    {
      fillColor: standardColorOf('blue', 100),
      font: {
        bold: true,
      },
    },
  ),
  ofAnyNumber: ruleOfCellCondition(
    ranges,
    {
      kind: 'numberIs',
      comparison: 'greaterThan',
      operand: {
        kind: 'number',
        number: -Number.MAX_VALUE,
      },
    },
    {
      font: {
        bold: true,
      },
    },
  ),
});
export const isFormatNonEmpty = (format: FormatOfACondition): boolean => Object.keys(format).length > 0;
export const MIDPOINT_PERCENTILE = 50;
export const DEFAULT_COLOR_SCALE: ColorScaleEffect = {
  kind: 'colorScale',
  lowest: {
    anchor: {
      kind: 'smallestNumber',
    },
    color: NO_COLOR,
  },
  middle: null,
  highest: {
    anchor: {
      kind: 'largestNumber',
    },
    color: {
      kind: 'standard',
      hue: 'green',
      shade: 300,
    },
  },
};
export const DEFAULT_SCALE_MIDPOINT: Stop<MiddleAnchor> = {
  anchor: {
    kind: 'percentile',
    percentile: MIDPOINT_PERCENTILE,
  },
  color: {
    kind: 'standard',
    hue: 'yellow',
    shade: 300,
  },
};
export const withScaleMidpoint = (scale: ColorScaleEffect, hasMiddle: boolean): ColorScaleEffect => ({
  ...scale,
  middle: hasMiddle ? (scale.middle ?? DEFAULT_SCALE_MIDPOINT) : null,
});
export const sortedNumbers = (numbers: number[]): number[] => numbers.toSorted((a, b) => a - b);
export const hasRepeatedNeighbor = (numbers: number[]): boolean =>
  numbers.some((number, index) => index > 0 && number === numbers[index - 1]);
export const isScaleColumn = (column: ColumnOfRecords): boolean => measureOfColumn(column) !== null;
export const testedColumnOfRule = (rule: RuleInIds): ColumnId =>
  rule.effect.kind === 'formatWhere' ? testedColumnOf(rule.effect.allOf[0], firstColumnOfRule(rule)) : firstColumnOfRule(rule);
