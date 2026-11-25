import type { Color, FormatOfACondition } from '@open-artifact/sheets-core';
import type { CellFontStyle, PaintPair } from '../../grid/cell-drawing.tsx';
import type { RuleDescription, RuleEffect, RuleEntry } from '../../messages/conditional-format.ts';
import { cellFontStyle, fillPaintStyle, textPaintStyle } from '../../grid/cell-drawing.tsx';
import { DEFAULT_CELL_FORMAT } from '../../model/cell-format.ts';
import { cellColorPair, colorScaleCellColors, colorScaleStepAt, fillColorPair } from '../cell-colors.ts';
import { NO_COLOR } from '../../model/colors.ts';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
/** One stripe of a striped sample: its place from the left and its fill, if any. */
export interface RuleSampleStripe {
  place: number;
  fill: PaintPair | null;
}
interface RuleSampleStripesProps {
  stripes: RuleSampleStripe[];
}
interface RuleEffectSampleProps {
  does: RuleEffect;
  isSwatch?: boolean;
}
interface SeveralRulesSampleProps {
  rules: RuleDescription[];
  isSwatch?: boolean;
}
interface RuleSampleProps {
  rules: RuleEntry;
  isSwatch?: boolean;
}
export function ruleSampleFontStyle({
  font,
}: Pick<FormatOfACondition, 'font'>): Pick<CellFontStyle, 'fontWeight' | 'fontStyle' | 'textDecorationLine' | 'textDecorationStyle'> {
  let {
    fontWeight,
    fontStyle,
    textDecorationLine,
    textDecorationStyle,
  } = cellFontStyle({
    ...DEFAULT_CELL_FORMAT.font,
    ...font,
  });
  return {
    fontWeight,
    fontStyle,
    textDecorationLine,
    textDecorationStyle,
  };
}
export function ruleFormatSampleProps(format: FormatOfACondition) {
  let { fill, text: textPaint } = cellColorPair(format.fillColor ?? NO_COLOR, format.font?.color ?? NO_COLOR);
  return {
    'data-has-fill': fill !== null || undefined,
    'data-has-text-paint': textPaint !== null || undefined,
    style: {
      ...fillPaintStyle(fill),
      ...textPaintStyle(textPaint),
      ...ruleSampleFontStyle(format),
    },
  };
}
export function colorScaleStripes([firstColor = NO_COLOR, ...otherColors]: Color[], count: number): RuleSampleStripe[] {
  let colorStops = [firstColor, ...otherColors].map(
    (color, index) => ({
      at: index / otherColors.length,
      color,
    }),
  );
  let [
    firstStop = {
      at: 0,
      color: firstColor,
    },
    ...otherStops
  ] = colorStops;
  return fillsToStripes(
    Array.from(
      {
        length: count,
      },
      (unfilledSpot, stripeIndex) =>
        colorScaleCellColors(colorScaleStepAt([firstStop, ...otherStops], stripeIndex / (count - 1)), NO_COLOR).fill,
    ),
  );
}
export function RuleSampleStripes({ stripes }: RuleSampleStripesProps) {
  return <>{stripes.map(
      ({ place, fill }) =>
        <span key={place} className="sheet-rule-sample-stripe" data-has-fill={fill !== null || undefined} style={fillPaintStyle(fill)} />,
    )}</>;
}
export function RuleEffectSample({ does, isSwatch = false }: RuleEffectSampleProps) {
  if (does.kind === 'colorScale')
    return <span aria-hidden className="sheet-rule-sample" data-is-swatch={isSwatch || undefined}><RuleSampleStripes stripes={colorScaleStripes(does.colors, isSwatch ? 18 : 30)} />{!isSwatch &&
          <span className="sheet-rule-sample-over-stripes">{CONDITIONAL_FORMATTING_WORDS.sample()}</span>}</span>;
  return <span aria-hidden className="sheet-rule-sample" data-is-swatch={isSwatch || undefined} {...ruleFormatSampleProps(does.format)}>{isSwatch ? CONDITIONAL_FORMATTING_WORDS.sampleLetter() : CONDITIONAL_FORMATTING_WORDS.sample()}</span>;
}
export function SeveralRulesSample({ rules, isSwatch = false }: SeveralRulesSampleProps) {
  let fills = rules.map(({ does }) => (does.kind === 'colorScale' ? does.colors[0] : does.format.fillColor));
  let [firstRule] = rules;
  if (firstRule !== undefined && fills.every((fill) => fillColorPair(fill ?? NO_COLOR) === null))
    return <RuleEffectSample does={firstRule.does} isSwatch={isSwatch} />;
  return <span aria-hidden className="sheet-rule-sample" data-is-swatch={isSwatch || undefined} data-is-striped={!isSwatch || undefined}><RuleSampleStripes stripes={fillsToStripes(fills.map((fill) => fillColorPair(fill ?? NO_COLOR)))} /></span>;
}
export function RuleSample({ rules, isSwatch = false }: RuleSampleProps) {
  switch (rules.kind) {
    case 'one':
      return <RuleEffectSample does={rules.rule.does} isSwatch={isSwatch} />;
    case 'several':
      return <RuleEffectSample does={rules.first.does} isSwatch={isSwatch} />;
    case 'oneColorForEach':
      return <span aria-hidden className="sheet-rule-sample" data-is-swatch={isSwatch || undefined}><RuleSampleStripes stripes={fillsToStripes(rules.fills.map(fillColorPair))} /></span>;
  }
}
export const fillsToStripes = (fills: (PaintPair | null)[]): RuleSampleStripe[] =>
  fills.map(
    (fill, place) => ({
      place,
      fill,
    }),
  );
