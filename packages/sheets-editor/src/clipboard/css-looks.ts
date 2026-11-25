import type { Border, BorderStyle, CellFormat, Color, HorizontalAlignment, VerticalAlignment } from '@open-artifact/sheets-core';
import { NO_COLOR } from '../model/colors.ts';
import { normalizeHexColor } from '../format/hsb-colors.ts';
import { unquoteCssString } from './html-reading.ts';
import type { BorderSide } from '../model/cell-format.ts';
import type { CssDeclarations, HtmlAttributes } from './html-reading.ts';

export type CellAlignment = NonNullable<CellFormat['alignment']>;
export type CellBorders = NonNullable<CellFormat['border']>;
export type CellFont = NonNullable<CellFormat['font']>;

/** What the CSS of a pasted cell sets, before it is compared with the copying program's defaults. */
export interface CssLook {
  alignment: CellAlignment;
  border: CellBorders;
  font: CellFont;
  fillColor?: Color;
  /** The cell's number format pattern, or the name of one (`mso-number-format`). */
  pattern?: string;
  /** Set where `mso-ignore` is given: whether the cell's text runs on into the cells after it, which are not merged. */
  isRunningOnAndNotMerged?: boolean;
}

/** How a cell of the copying program looks when its CSS sets nothing. */
export interface DefaultCellLook {
  horizontal: HorizontalAlignment;
  vertical: VerticalAlignment | null;
  hexOfGridLine: string | null;
}

export type ProgramOfHtml = 'googleSheets' | 'excel';

export function programOfHtmlTag(tagName: string, attributes: HtmlAttributes): ProgramOfHtml | null {
  if (tagName === 'google-sheets-html-origin' || attributes.has('data-sheets-root')) return 'googleSheets';
  return tagName === 'meta' && attributes.get('name')?.toLowerCase() === 'progid' && attributes.get('content')?.toLowerCase() === 'excel.sheet'
    ? 'excel'
    : null;
}
export function parseCssColor(cssColor: string): Color | null {
  const lowered = cssColor.toLowerCase();
  if (lowered === 'windowtext') return NO_COLOR;
  if (lowered.startsWith('#')) {
    let hex = normalizeHexColor(lowered);
    return hex === null
      ? null
      : {
          kind: 'rgb',
          hex,
        };
  }
  let match = CSS_RGB_PATTERN.exec(lowered);
  if (match === null) return CSS_NAMED_COLORS.get(lowered) ?? null;
  let [red, green, blue] = [match[1], match[2], match[3]].map(Number);
  if (red === undefined || green === undefined || blue === undefined) return null;
  if (Math.max(red, green, blue) > 255 || (match[4] !== undefined && Number(match[4]) < 1)) return null;
  return {
    kind: 'rgb',
    hex: `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`,
  };
}
export function borderStyleOfWidth(width: string): BorderStyle {
  let [, amount, unit] = CSS_LENGTH_PATTERN.exec(width) ?? [];
  let pixels = unit === 'pt' ? Number(amount) * 2 : Number(amount);
  if (pixels >= 3) return 'thick';
  return pixels >= 2 ? 'medium' : 'thin';
}
export function parseCssBorder(cssBorder: string): Border | null {
  let words = cssValueWords(cssBorder);
  if (words.includes('none') || words.includes('hidden'))
    return {
      kind: 'none',
    };
  let style = words.map((word) => CSS_BORDER_STYLES.get(word)).find((found) => found !== undefined);
  if (style === undefined) return null;
  let width = words.find((word) => CSS_LENGTH_PATTERN.test(word)) ?? '';
  let colorWord = words.find((word) => !CSS_LENGTH_PATTERN.test(word) && !CSS_BORDER_STYLES.has(word));
  if (colorWord === 'transparent')
    return {
      kind: 'none',
    };
  return {
    kind: 'line',
    style: style === 'byWidth' ? borderStyleOfWidth(width) : style,
    color: (colorWord === undefined ? null : parseCssColor(colorWord)) ?? NO_COLOR,
  };
}
export function bordersOfCss(declarations: CssDeclarations): CellBorders {
  const borders: CellBorders = {};
  for (let side of CELL_BORDER_SIDES) {
    let cssBorder = declarations.get(`border-${side}`) ?? declarations.get('border');
    let border = cssBorder === undefined ? null : parseCssBorder(cssBorder);
    if (border !== null) borders[side] = border;
  }
  return borders;
}
export function fontOfCss(declarations: CssDeclarations): CellFont {
  const font: CellFont = {};
  let fontWeight = declarations.get('font-weight');
  if (fontWeight !== undefined) font.bold = fontWeight === 'bold' || Number(fontWeight) >= 600;
  let fontStyle = declarations.get('font-style');
  if (fontStyle !== undefined) font.italic = fontStyle === 'italic';
  let decoration = declarations.get('text-decoration') ?? declarations.get('text-decoration-line');
  if (decoration !== undefined) {
    let isDoubleUnderline = declarations.get('text-underline-style') === 'double';
    font.underline = !decoration.includes('underline') ? 'none' : isDoubleUnderline ? 'double' : 'single';
    font.strikethrough = decoration.includes('line-through');
  }
  let color = parseCssColor(declarations.get('color') ?? '');
  if (color !== null) font.color = color;
  let [, sizeAmount, sizeUnit] = CSS_LENGTH_PATTERN.exec(declarations.get('font-size') ?? '') ?? [];
  let points = Math.round(sizeUnit === 'px' ? Number(sizeAmount) * 0.75 : Number(sizeAmount));
  if (points >= 1 && points <= 409) font.size = points;
  return font;
}
export function alignmentOfCss(declarations: CssDeclarations): CellAlignment {
  const alignment: CellAlignment = {};
  const textAlign = declarations.get('text-align');
  if (textAlign !== undefined) {
    const isSupported = textAlign === 'left' || textAlign === 'center' || textAlign === 'right';
    alignment.horizontal = isSupported ? textAlign : 'general';
  }
  let verticalAlign = declarations.get('vertical-align');
  let vertical = verticalAlign === 'middle' ? 'center' : verticalAlign;
  if (vertical === 'top' || vertical === 'center' || vertical === 'bottom') alignment.vertical = vertical;
  let whiteSpace = declarations.get('white-space');
  if (whiteSpace !== undefined) alignment.wrap = whiteSpace === 'normal';
  return alignment;
}
export function lookOfCss(declarations: CssDeclarations): CssLook {
  let fillColor = cssValueWords(declarations.get('background-color') ?? declarations.get('background') ?? '').flatMap(
    (word) => {
      let color = parseCssColor(word);
      return color === null || color.kind === 'none' ? [] : [color];
    },
  )[0];
  let numberFormat = declarations.get('mso-number-format');
  let msoIgnore = declarations.get('mso-ignore');
  return {
    alignment: alignmentOfCss(declarations),
    border: bordersOfCss(declarations),
    font: fontOfCss(declarations),
    ...(fillColor !== undefined && {
      fillColor,
    }),
    ...(numberFormat !== undefined && {
      pattern: unquoteCssString(numberFormat),
    }),
    ...(msoIgnore !== undefined && {
      isRunningOnAndNotMerged: msoIgnore === 'colspan',
    }),
  };
}
export function formatOfCssLook(look: CssLook, defaults: DefaultCellLook): CellFormat {
  let { horizontal, vertical, wrap } = look.alignment;
  let alignment: NonNullable<CellFormat['alignment']> = {
    ...(horizontal !== undefined &&
      horizontal !== 'general' &&
      horizontal !== defaults.horizontal && {
        horizontal,
      }),
    ...(vertical !== undefined &&
      vertical !== defaults.vertical && {
        vertical,
      }),
    ...(wrap === true && {
      wrap: 'wrap',
    }),
  };
  let { bold, italic, underline, strikethrough, color, size } = look.font;
  let font = {
    ...(bold === true && {
      bold,
    }),
    ...(italic === true && {
      italic,
    }),
    ...(underline !== undefined &&
      underline !== 'none' && {
        underline,
      }),
    ...(strikethrough === true && {
      strikethrough,
    }),
    ...(color !== undefined &&
      !isPlainBlackColor(color) && {
        color,
      }),
    ...(size !== undefined && {
      size,
    }),
  };
  const borders: CellBorders = {};
  for (let side of CELL_BORDER_SIDES) {
    let sideBorder = look.border[side];
    let isGridLine =
      sideBorder?.kind === 'line' &&
      sideBorder.style === 'thin' &&
      sideBorder.color.kind === 'rgb' &&
      sideBorder.color.hex === defaults.hexOfGridLine;
    if (sideBorder !== undefined && !isGridLine) borders[side] = sideBorder;
  }
  return {
    ...(Object.keys(alignment).length > 0 && {
      alignment,
    }),
    ...(look.fillColor !== undefined && {
      fillColor: look.fillColor,
    }),
    ...(Object.keys(borders).length > 0 && {
      border: borders,
    }),
    ...(Object.keys(font).length > 0 && {
      font,
    }),
  };
}
export const CSS_NAMED_COLORS = new Map(
  Object.entries({
    black: '#000000',
    silver: '#c0c0c0',
    gray: '#808080',
    white: '#ffffff',
    maroon: '#800000',
    red: '#ff0000',
    purple: '#800080',
    fuchsia: '#ff00ff',
    green: '#008000',
    lime: '#00ff00',
    olive: '#808000',
    yellow: '#ffff00',
    navy: '#000080',
    blue: '#0000ff',
    teal: '#008080',
    aqua: '#00ffff',
  }).map(
    ([colorName, hex]): [string, Color] => [
      colorName,
      {
        kind: 'rgb',
        hex,
      },
    ],
  ),
);
export const CSS_RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/;
export const cssValueWords = (cssValue: string): string[] => cssValue.toLowerCase().replaceAll(/,\s+/g, ',').split(/\s+/);
export const CSS_LENGTH_PATTERN = /^(\d+(?:\.\d+)?|\.\d+)(pt|px)$/;
export const CSS_BORDER_STYLES = new Map<string, BorderStyle | 'byWidth'>([
  ['solid', 'byWidth'],
  ['dashed', 'dashed'],
  ['dotted', 'dotted'],
  ['double', 'double'],
  ['hairline', 'thin'],
  ['dot-dash', 'dashed'],
  ['dot-dot-dash', 'dashed'],
  ['dot-dash-slanted', 'dashed'],
]);
export const CELL_BORDER_SIDES: BorderSide[] = ['top', 'bottom', 'left', 'right'];
export const MOST_NUMBER_FORMAT_LENGTH = 1000;
export const EMPTY_CSS_LOOK: CssLook = {
  alignment: {},
  border: {},
  font: {},
};
export const mergeCssLooks = (look: CssLook, over: CssLook): CssLook => ({
  ...look,
  ...over,
  alignment: {
    ...look.alignment,
    ...over.alignment,
  },
  border: {
    ...look.border,
    ...over.border,
  },
  font: {
    ...look.font,
    ...over.font,
  },
});
export const isPlainBlackColor = (color: Color): boolean => color.kind === 'none' || (color.kind === 'rgb' && color.hex === '#000000');
export const EXCEL_NAMED_NUMBER_FORMATS = new Map<string, string>([
  ['Fixed', '0.00'],
  ['Standard', '#,##0.00'],
  ['Percent', '0.00%'],
  ['Scientific', '0.00E+00'],
  ['Currency', '"$"#,##0.00_);[Red]\\("$"#,##0.00\\)'],
  ['General Date', 'm/d/yyyy h:mm'],
  ['Short Date', 'm/d/yyyy'],
  ['Medium Date', 'd-mmm-yy'],
  ['Long Date', 'dddd, mmmm d, yyyy'],
  ['Short Time', 'h:mm'],
  ['Medium Time', 'h:mm AM/PM'],
  ['Long Time', 'h:mm:ss AM/PM'],
]);
