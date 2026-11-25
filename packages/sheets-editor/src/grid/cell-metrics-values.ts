import { MAX_ROW_HEIGHT } from '../model/line-sizes.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
/** How closely the grid sets its rows. */
export type CellDensity = 'compact' | 'comfortable';
export const ROW_HEADER_WIDTH = 48;
export const DEFAULT_CELL_DENSITY: CellDensity = 'comfortable';
export const fontPointsToPixels = (points: number): number => (13 * points) / 10;
export const FIRST_LINE_HEIGHT_RATIO = 1.3;
export const MIN_FIRST_LINE_HEIGHT = 18;
export const firstLineHeight = (fontSize: number): number =>
  Math.max(MIN_FIRST_LINE_HEIGHT, Math.ceil(FIRST_LINE_HEIGHT_RATIO * fontPointsToPixels(fontSize)));
export const TEXT_LINE_HEIGHT_RATIO = 1.2;
export const firstLineLeading = (fontSize: number): number =>
  Math.round((firstLineHeight(fontSize) - TEXT_LINE_HEIGHT_RATIO * fontPointsToPixels(fontSize)) / 2);
export const nextLineHeight = (fontSize: number): number => firstLineHeight(fontSize) - 2 * firstLineLeading(fontSize);
/** The room a cell leaves around its text, in pixels. */
export interface CellPadding {
  over: number;
  under: number;
  beside: number;
  besideBox: number;
  besideBoxAtRight: number;
  afterMark: number;
  markIntoWords: number;
}
export const CELL_PADDING_BY_DENSITY: Record<CellDensity, CellPadding> = {
  comfortable: {
    over: 5,
    under: 4,
    beside: 6,
    besideBox: 3,
    besideBoxAtRight: 4,
    afterMark: 5,
    markIntoWords: 2,
  },
  compact: {
    over: 2,
    under: 2,
    beside: 4,
    besideBox: 4,
    besideBoxAtRight: 4,
    afterMark: 3,
    markIntoWords: 0,
  },
};
export const GRIDLINE_THICKNESS = 1;
export const rowHeightForLines = (lineCount: number, fontSize: number, { over, under }: Pick<CellPadding, 'over' | 'under'>): number =>
  Math.min(MAX_ROW_HEIGHT, over + firstLineHeight(fontSize) + (lineCount - 1) * nextLineHeight(fontSize) + under + GRIDLINE_THICKNESS);
export const rowHeightForLinesAtDensity = (lineCount: number, fontSize: number, density: CellDensity): number =>
  rowHeightForLines(lineCount, fontSize, CELL_PADDING_BY_DENSITY[density]);
export const oneLineRowHeight = (fontSize: number, density: CellDensity): number => rowHeightForLinesAtDensity(1, fontSize, density);
export const defaultRowHeightAtDensity = (density: CellDensity): number => oneLineRowHeight(DEFAULT_CELL_FORMAT.font.size, density);
export const DEFAULT_ROW_HEIGHT = defaultRowHeightAtDensity(DEFAULT_CELL_DENSITY);
