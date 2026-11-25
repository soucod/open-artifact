import type { Border, BorderStyle, Hue, VerticalAlignment } from '@open-artifact/sheets-core';
import { strongerBorder, borderPaint, borderStyleWidth } from '../grid/borders.ts';
import { PAGE_TEXT_COLORS, PAGE_BACKGROUND_COLORS, CELL_COLOR_PALETTE } from '../format/cell-colors.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import type { ShownHorizontalAlignment } from '../format/toolbar-choices.ts';
import type { CellLook } from '../grid/header-gray-fill.ts';
import type { CellArea } from '../selection/model.ts';
import type { BorderSide } from '../model/cell-format.ts';

/** A copied cell as its HTML is written: how it is drawn, its alignment as shown, and the name of its number format's text color. */
export interface CellToCopyAsHtml {
  look: CellLook;
  alignment: ShownHorizontalAlignment;
  tint: string | null;
}

/** A merged area over the copied cells, by positions among them, with the cell at its top left. */
export interface MergedAreaToCopy extends CellArea {
  first: CellToCopyAsHtml | null;
}

/** A merged area clipped to the copied cells: its first and last rows and columns. */
interface MergeInCopy {
  top: number;
  left: number;
  bottom: number;
  right: number;
  of: MergedAreaToCopy;
}

export function cssBorderDeclaration(side: BorderSide, neighborBorder: Border, ownBorder: Border): string[] {
  let border = strongerBorder(neighborBorder, ownBorder);
  if (border === null) return [];
  let { onLight: color } = borderPaint(border) ?? PAGE_TEXT_COLORS;
  return cssColorDeclaration(`border-${side}`, `${borderStyleWidth(border.style)}px ${HTML_BORDER_STYLES[border.style]}`, color);
}
export function formatColorCss(tint: string): string {
  if (tint === 'black' || tint === 'white') return (tint === 'black' ? PAGE_TEXT_COLORS : PAGE_BACKGROUND_COLORS).onLight;
  return CELL_COLOR_PALETTE[FORMAT_COLOR_PALETTE_FAMILIES[tint]][600];
}
export function htmlCellAttributesOf(
  cellRows: readonly (readonly (CellToCopyAsHtml | null)[])[],
  mergedAreas: readonly MergedAreaToCopy[],
  isInsideTable: boolean,
): (string | null)[][] {
  let columnCount = cellRows[0]?.length ?? 0;
  const mergeByIndex = new Map<number, MergeInCopy>();
  for (let mergedArea of mergedAreas) {
    let merge: MergeInCopy = {
      top: Math.max(mergedArea.topRowIndex, 0),
      left: Math.max(mergedArea.leftColumnIndex, 0),
      bottom: Math.min(mergedArea.topRowIndex + mergedArea.rowCount, cellRows.length) - 1,
      right: Math.min(mergedArea.leftColumnIndex + mergedArea.columnCount, columnCount) - 1,
      of: mergedArea,
    };
    for (let rowIndex = merge.top; rowIndex <= merge.bottom; rowIndex += 1)
      for (let columnIndex = merge.left; columnIndex <= merge.right; columnIndex += 1)
        mergeByIndex.set(rowIndex * columnCount + columnIndex, merge);
  }
  let bordersAt = (rowIndex: number, columnIndex: number) => cellRows[rowIndex]?.[columnIndex]?.look.format.border;
  let borderSideAt = (rowIndex: number, columnIndex: number, side: BorderSide): Border => {
    let border = bordersAt(rowIndex, columnIndex)?.[side] ?? NO_BORDER_SIDE;
    return border.kind === 'line' && !Object.hasOwn(HTML_BORDER_STYLES, border.style) ? NO_BORDER_SIDE : border;
  };
  return cellRows.map(
    (row, rowIndex) =>
      row.map((cell, columnIndex) => {
        let merge = mergeByIndex.get(rowIndex * columnCount + columnIndex);
        if (merge !== undefined && (merge.top !== rowIndex || merge.left !== columnIndex)) return null;
        let { bottom = rowIndex, right = columnIndex, of: mergedArea } = merge ?? {};
        let anchorCell = mergedArea === undefined ? cell : mergedArea.first;
        let hasEdge = {
          top: mergedArea === undefined || mergedArea.topRowIndex === rowIndex,
          right: mergedArea === undefined || mergedArea.leftColumnIndex + mergedArea.columnCount - 1 === right,
          bottom: mergedArea === undefined || mergedArea.topRowIndex + mergedArea.rowCount - 1 === bottom,
          left: mergedArea === undefined || mergedArea.leftColumnIndex === columnIndex,
        };
        let { font, alignment } = anchorCell?.look.format ?? DEFAULT_CELL_FORMAT;
        let { text: textPaint = null, fill: fillPaint = null } = anchorCell?.look.paints ?? {};
        let backgroundStyles = fillPaint === null ? [] : cssColorDeclaration('background-color', '', fillPaint.onLight);
        let tint = anchorCell?.look.isTextColorFromRule === true ? null : (anchorCell?.tint ?? null);
        let textColor = fillPaint !== null && backgroundStyles.length === 0 ? undefined : textPaint?.onLight;
        let color = tint === null ? textColor : formatColorCss(tint);
        let isAlignmentKept = anchorCell?.alignment !== 'left' || alignment.horizontal === 'left';
        let decorations = [...(font.underline === 'none' ? [] : ['underline']), ...(font.strikethrough ? ['line-through'] : [])];
        let isDoubleUnderline = font.underline === 'double' && !font.strikethrough;
        let style = [
          ...(isInsideTable ? [] : [HTML_CELL_BORDER_STYLE]),
          ...(hasEdge.top
            ? cssBorderDeclaration('top', borderSideAt(rowIndex - 1, columnIndex, 'bottom'), borderSideAt(rowIndex, columnIndex, 'top'))
            : []),
          ...(hasEdge.right ? cssBorderDeclaration('right', borderSideAt(rowIndex, right, 'right'), borderSideAt(rowIndex, right + 1, 'left')) : []),
          ...(hasEdge.bottom
            ? cssBorderDeclaration('bottom', borderSideAt(bottom, columnIndex, 'bottom'), borderSideAt(bottom + 1, columnIndex, 'top'))
            : []),
          ...(hasEdge.left
            ? cssBorderDeclaration('left', borderSideAt(rowIndex, columnIndex - 1, 'right'), borderSideAt(rowIndex, columnIndex, 'left'))
            : []),
          ...(font.size === DEFAULT_CELL_FORMAT.font.size || !Number.isFinite(font.size) ? [] : [`font-size:${font.size}pt`]),
          ...(font.bold ? ['font-weight:bold'] : []),
          ...(font.italic ? ['font-style:italic'] : []),
          ...(decorations.length === 0 ? [] : [`text-decoration:${decorations.join(' ')}`]),
          ...(isDoubleUnderline ? ['text-decoration-style:double'] : []),
          ...(color === undefined ? [] : cssColorDeclaration('color', '', color)),
          ...backgroundStyles,
          ...(isAlignmentKept && ['left', 'center', 'right'].includes(anchorCell?.alignment ?? '') ? [`text-align:${anchorCell?.alignment}`] : []),
          ...(Object.hasOwn(HTML_VERTICAL_ALIGN, alignment.vertical) ? [`vertical-align:${HTML_VERTICAL_ALIGN[alignment.vertical]}`] : []),
        ].join(';');
        return [
          ...(bottom === rowIndex ? [] : [` rowspan="${bottom - rowIndex + 1}"`]),
          ...(right === columnIndex ? [] : [` colspan="${right - columnIndex + 1}"`]),
          ...(style === '' ? [] : [` style="${style}"`]),
        ].join('');
      }),
  );
}
export const HTML_CELL_BORDER_STYLE = 'border:1px solid #ccc';
export const HTML_BORDERED_STYLE_ATTRIBUTE = ` style="${HTML_CELL_BORDER_STYLE}"`;
export const HTML_BORDER_STYLES: Record<BorderStyle, string> = {
  thin: 'solid',
  medium: 'solid',
  thick: 'solid',
  dashed: 'dashed',
  dotted: 'dotted',
  double: 'double',
};
export const NO_BORDER_SIDE: Border = {
  kind: 'none',
};
export const HTML_VERTICAL_ALIGN: Partial<Record<VerticalAlignment, string>> = {
  center: 'middle',
  bottom: 'bottom',
};
export const cssColorDeclaration = (property: string, prefix: string, color: string): string[] =>
  /^#[0-9a-f]{6}$/i.test(color) ? [`${property}:${prefix === '' ? '' : `${prefix} `}${color}`] : [];
/** The palette family of each text color a number format names. */
export const FORMAT_COLOR_PALETTE_FAMILIES: Readonly<Record<string, Hue>> = {
  blue: 'blue',
  cyan: 'teal',
  gray: 'gray',
  green: 'green',
  magenta: 'magenta',
  orange: 'orange',
  red: 'red',
  violet: 'purple',
  yellow: 'yellow',
};
