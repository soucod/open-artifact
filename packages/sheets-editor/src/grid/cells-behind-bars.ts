import { textLineMiddleY, textRoomInWidth, CELL_TEXT_PADDING_X } from './cell-metrics.ts';
import { rowHeightForLinesAtDensity } from './cell-metrics-values.ts';
import { cellsHeightAboveFloats, cellsAreaHeight } from './geometry.ts';
import type { BoxAtFoot, PageState } from '../state/initial-state.ts';
import type { TextMeasurer } from '../state/controller.ts';
import type { CellDensity } from './cell-metrics-values.ts';
import type { DrawnCell, DrawnRow } from './grid-drawing.tsx';
/** The top edge of the bars over the foot of the grid, and the stretch across the body they cover. */
export interface BarEdge {
  edge: number;
  from: number;
  to: number;
}
/** What of a drawn cell tells where the middle of its text is. */
export type CellToFindTextIn = Pick<
  DrawnCell,
  | 'left'
  | 'width'
  | 'height'
  | 'text'
  | 'textLeft'
  | 'textWidth'
  | 'alignment'
  | 'format'
  | 'hiddenByBorderAtFoot'
  | 'isTextWrapped'
  | 'isPerson'
  | 'pill'
  | 'linkUrl'
  | 'checkbox'
>;
/** Where the grid's body is drawn, for telling which cells are behind the bars. */
export interface BodyUnderBars {
  density: CellDensity;
  leftOfBody: number;
}
export function middleOfCellTextFromTop(
  cell: CellToFindTextIn,
  density: CellDensity,
  measurer: Pick<TextMeasurer, 'lineCountsOfWrappedTexts'>,
): number {
  let { height, format, hiddenByBorderAtFoot, text } = cell;
  if (isCellMarkInMiddle(cell)) return height / 2;
  let { vertical } = format.alignment;
  let { size } = format.font;
  let middle = textLineMiddleY(height, size, vertical, density, hiddenByBorderAtFoot);
  if (!cell.isTextWrapped || vertical === 'center') return middle;
  let [lineCount = 1] = measurer.lineCountsOfWrappedTexts([
    {
      text,
      font: format.font,
      widthInPixels: textRoomInWidth(cell.width),
    },
  ]);
  let extraHeight = rowHeightForLinesAtDensity(lineCount, size, density) - rowHeightForLinesAtDensity(1, size, density);
  return middle + ((vertical === 'top' ? 1 : -1) * extraHeight) / 2;
}
export function spanOfCellText(cell: CellToFindTextIn, measurer: Pick<TextMeasurer, 'widthOfCharacters'>): [number, number] {
  let { left, width, text, alignment } = cell;
  if (isCellMarkInMiddle(cell)) return [left + width / 2, left + width / 2];
  if (cell.isPerson || cell.pill !== null || cell.linkUrl !== null) return [left, left + width];
  let room = textRoomInWidth(cell.textWidth);
  let textWidth = cell.isTextWrapped ? room : Math.min(room, measurer.widthOfCharacters(text, cell.format.font));
  let alignedBy =
    {
      left: 0,
      center: 0.5,
      right: 1,
    }[alignment] *
    (room - textWidth);
  let middle = cell.textLeft + CELL_TEXT_PADDING_X / 2 + alignedBy + textWidth / 2;
  return [middle, middle];
}
export function edgesOfBarsAtFoot(state: PageState, leftOfBody: number): BarEdge[] {
  let clearance = BARS_CLEARANCE / state.zoom;
  if (state.isNarrowByTouch)
    return [
      {
        edge: cellsHeightAboveFloats(state) - clearance,
        from: -1 / 0,
        to: 1 / 0,
      },
    ];
  return [
    ...state.boxesAtFootByTouch,
    {
      left: -1 / 0,
      right: 1 / 0,
      heightUnder: 0,
    },
  ]
    .slice(state.boxesAtFootByTouch.length === 0 ? 1 : 0)
    .map(
      ({ left, right, heightUnder }: BoxAtFoot = {} as BoxAtFoot) => ({
        edge: cellsAreaHeight(state) - heightUnder - clearance,
        from: left - leftOfBody,
        to: right - leftOfBody,
      }),
    );
}
export function rowsWithCellsBehindBars(
  rows: readonly DrawnRow[],
  edges: readonly BarEdge[],
  { density, leftOfBody }: BodyUnderBars = {} as BodyUnderBars,
  measurer: Pick<TextMeasurer, 'lineCountsOfWrappedTexts' | 'widthOfCharacters'>,
): DrawnRow[] {
  let highestEdge = Math.min(...edges.map(({ edge }: BarEdge = {} as BarEdge) => edge));
  let isBehindBars = (top: number, [from, to]: readonly number[] = []) =>
    edges.some(({ edge, from: barFrom, to: barTo }: BarEdge = {} as BarEdge) => top > edge && to > barFrom && from < barTo);
  return rows.map((row): DrawnRow => {
    let height = Math.max(row.height, ...row.cells.map(({ top, height: cellHeight }: DrawnCell = {} as DrawnCell) => top + cellHeight));
    if (row.top + height <= highestEdge) return row;
    let cells = row.cells.map(
      (cell) =>
        !cell.isActive && isBehindBars(row.top + cell.top + middleOfCellTextFromTop(cell, density, measurer), spanOfCellText(cell, measurer))
          ? {
              ...cell,
              isBehindBars: true,
            }
          : cell,
    );
    let heightInView = row.height - row.outOfViewAbove - row.outOfViewBelow;
    let isNumberBehindBars = isBehindBars(row.top + row.outOfViewAbove + heightInView / 2, [-leftOfBody / 2, -leftOfBody / 2]);
    return {
      ...row,
      cells,
      isNumberBehindBars,
      isBehindBars: isNumberBehindBars && cells.every(({ isBehindBars: isCellBehindBars }: DrawnCell = {} as DrawnCell) => isCellBehindBars),
    };
  });
}
export const BARS_CLEARANCE = 3;
export const isCellMarkInMiddle = (cell: Pick<DrawnCell, 'checkbox' | 'text' | 'isPerson'>): boolean => cell.checkbox !== null || (cell.text.trim() === '' && !cell.isPerson);
