import type { ShownColor } from '@open-artifact/sheets-core';
import { selectedChartInputAreas } from '../charts/placed-views.ts';
import { areasOverlap } from '../model/workbook.ts';
import { isCommentMarkedOnGrid } from '../comments/comment-state.ts';
import { selectedAreaAsSeen } from '../presence/selections.ts';
import { isSpanInSight, paneRect } from './geometry.ts';
import { checkboxCentreInCell } from '../chips/checkbox-presses.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { PageState } from '../state/initial-state.ts';
import type {
  AreaSpansOnScreen,
  EdgesOfCells,
  ExtraReach,
  GridPoint,
  GridScroll,
  PaneRect,
  ShownStretch,
  SpanOnScreen,
  StartAndEnd,
} from './geometry.ts';
import type { GridView } from './grid-view.ts';
import type { TextTintName } from './cell-drawing.tsx';
/** A box drawn over the grid, and the part of the screen it shows in. */
export interface DrawnBox extends PaneRect {
  showsIn: PaneRect;
}
/** Where the middle of a checkbox is, from the left and the top of the box it is drawn in. */
export interface CheckboxMiddle {
  middleFromLeft: number;
  middleFromTop: number;
}
/** Where a stretch starts, and how long it is. */
export interface StartAndSize {
  start: number;
  size: number;
}
/** The entry box's left, top and width, before it is laid out. */
export type EditorBoxOfSpans = Pick<PaneRect, 'left' | 'top' | 'width'>;
export function textColorNameOf(color: ShownColor): TextTintName | null {
  if (color.kind === 'named') return color.name;
  return INDEXED_FORMAT_COLOR_NAMES[color.index - 1] ?? null;
}
export function makeIsAreaMarkedByEntry(state: PageState, reads: WorkbookReads): (area: CellArea) => boolean {
  let areasMarked = [
    ...state.referencesInEntry.flatMap(
      (reference) => (reference.sheetId === state.sheetId ? (reference.pieces ?? [reference.area]) : []),
    ),
    ...(state.referencesInEntry.length > 0 ? [] : selectedChartInputAreas(state, reads)).map(({ area }) => area),
  ];
  return (area: CellArea): boolean => areasMarked.some((markedArea: CellArea) => areasOverlap(markedArea, area));
}
export function makeIsCellMarkedForAttention(state: PageState, reads: WorkbookReads): (cellId: CellId, area: CellArea) => boolean {
  let { sheetId } = state;
  let foundCellKeys = new Set<string>((state.find?.hits ?? []).map(({ cellId }) => cellDrawKey(cellId)));
  let commentAreas = [
    ...(state.newCommentOn === null ? [] : [state.newCommentOn]),
    ...(state.comments ?? []).flatMap((comment) => (isCommentMarkedOnGrid(state, comment) ? [comment.cells] : [])),
  ].flatMap((cells) => (cells.activeCell.sheetId === sheetId ? (selectedAreaAsSeen(cells, reads) ?? []) : []));
  let isMarkedByEntry = makeIsAreaMarkedByEntry(state, reads);
  return (cellId: CellId, area: CellArea): boolean =>
    foundCellKeys.has(cellDrawKey(cellId)) ||
    isMarkedByEntry(area) ||
    commentAreas.some((commentArea: CellArea) => areasOverlap(commentArea, area));
}
export function clipBoxToShown({ left, top, width, height, showsIn }: DrawnBox): PaneRect {
  let [clippedLeft, clippedTop] = [Math.max(left, showsIn.left), Math.max(top, showsIn.top)];
  return {
    left: clippedLeft,
    top: clippedTop,
    width: Math.min(left + width, showsIn.left + showsIn.width) - clippedLeft,
    height: Math.min(top + height, showsIn.top + showsIn.height) - clippedTop,
  };
}
export function drawnBoxOfSpans({ across, down }: AreaSpansOnScreen, margin: number = BOX_MARGIN_PAST_SIGHT): DrawnBox | null {
  if (!isSpanInSight(across) || !isSpanInSight(down)) return null;
  let startOf = ({ start, showFrom }: SpanOnScreen): number => Math.max(start, showFrom - margin);
  let endOf = ({ end, showTo, isEndUnderFrozenLines }: SpanOnScreen): number =>
    isEndUnderFrozenLines ? showTo + BOX_MARGIN_PAST_SIGHT : Math.min(end, showTo + margin);
  let [left, top] = [startOf(across), startOf(down)];
  return {
    left,
    top,
    width: endOf(across) - left,
    height: endOf(down) - top,
    showsIn: paneRect(across, down),
  };
}
export function checkboxMiddleInBox(
  cellBox: Pick<PaneRect, 'left' | 'top'>,
  cellRect: EdgesOfCells,
  shownBox: PaneRect,
  hiddenAtFoot: number,
): CheckboxMiddle {
  let middle = checkboxCentreInCell(cellRect.right - cellRect.left, cellRect.bottom - cellRect.top, hiddenAtFoot);
  return {
    middleFromLeft: clampToTwiceSize(cellBox.left + middle.x - shownBox.left, shownBox.width),
    middleFromTop: clampToTwiceSize(cellBox.top + middle.y - shownBox.top, shownBox.height),
  };
}
export function indentToCenterIn(span: StartAndEnd, box: Pick<PaneRect, 'left' | 'width'>): number {
  let roomBefore = box.left - span.start;
  let roomAfter = span.end - (box.left + box.width);
  return Math.max(-2 * box.width, Math.min(roomAfter - roomBefore, 2 * box.width));
}
export function clipSpanToShown(start: number, size: number, shownStart: number, shownEnd: number): [number, number] {
  if (size <= shownEnd - shownStart) return [start, size];
  let clippedStart = Math.max(start, shownStart);
  return [clippedStart, Math.min(start + size, shownEnd) - clippedStart];
}
export const INDEXED_FORMAT_COLOR_NAMES: readonly TextTintName[] = [
  'black',
  'white',
  'red',
  'green',
  'blue',
  'yellow',
  'magenta',
  'cyan',
  'red',
  'green',
  'blue',
  'yellow',
  'magenta',
  'cyan',
  'gray',
  'gray',
  'blue',
  'magenta',
  'yellow',
  'cyan',
  'magenta',
  'red',
  'blue',
  'blue',
  'blue',
  'magenta',
  'yellow',
  'cyan',
  'magenta',
  'red',
  'cyan',
  'blue',
  'cyan',
  'cyan',
  'green',
  'yellow',
  'blue',
  'magenta',
  'violet',
  'orange',
  'blue',
  'cyan',
  'yellow',
  'yellow',
  'orange',
  'orange',
  'blue',
  'gray',
  'blue',
  'green',
  'green',
  'yellow',
  'orange',
  'magenta',
  'blue',
  'gray',
];
export const cellDrawKey = ({ sheetId, rowId, columnId }: CellId): string => `${sheetId} ${rowId} ${columnId}`;
export const commentMarksAtPoint = ({ body, marksOfComments }: Pick<GridView, 'body' | 'marksOfComments'>, point: GridPoint) =>
  marksOfComments.flatMap((mark: GridView['marksOfComments'][number]) => {
    let { left, top, width, height } = clipBoxToShown(mark);
    let [x, y] = [point.x - body.left - left, point.y - body.top - top];
    return x >= 0 && x < width && y >= 0 && y < height ? [mark.key] : [];
  });
export const BOX_MARGIN_PAST_SIGHT = 8;
export const BIG_BOX_MARGIN_PAST_SIGHT = 4096;
export const startAndSizeOf = ({ start, end }: StartAndEnd): StartAndSize => ({
  start,
  size: end - start,
});
export const paneWithExtraReach = <P extends ShownStretch>(pane: P, { before, after }: ExtraReach = {} as ExtraReach): P => ({
  ...pane,
  showFrom: pane.showFrom - before,
  showTo: pane.showTo + after,
});
export const editorBoxOfSpans = ({ across, down }: AreaSpansOnScreen): EditorBoxOfSpans => ({
  left: across.start,
  top: down.start,
  width: across.end - across.start,
});
export const withEndsNotUnderFrozenLines = ({ across, down }: AreaSpansOnScreen): AreaSpansOnScreen => ({
  across: {
    ...across,
    isEndUnderFrozenLines: false,
  },
  down: {
    ...down,
    isEndUnderFrozenLines: false,
  },
});
export const boxInScrolledPane = ({ scrollLeft, scrollTop }: GridScroll, rect: EdgesOfCells): PaneRect => ({
  left: rect.left - scrollLeft,
  top: rect.top - scrollTop,
  width: rect.right - rect.left,
  height: rect.bottom - rect.top,
});
export const clampToTwiceSize = (offset: number, size: number): number => Math.max(-size, Math.min(offset, 2 * size));
export const NO_EDITOR_LAYOUT = {
  editorBox: null,
  editorLineCount: 1,
  editorFoldsAt: null,
};
