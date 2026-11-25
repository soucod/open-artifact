import { resetScrollForFreezeDrag, layoutOfView } from '../grid/layout.ts';
import { hitTestGrid, rangeSpansOnScreen, isInSpan, type GridPoint, type PaneRect } from '../grid/geometry.ts';
import { areaOfPosition } from '../selection/model.ts';
import { drawnBoxOfSpans, clipBoxToShown } from '../grid/view-boxes.ts';
import { AGENT_FLAG_WIDTH, FLAG_HEIGHT } from './flags.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { BoxShownIn } from '../selection/finger-taps.ts';
import type { FlagToPlace, NameFlagGroup, PlacedFlag } from './flags.ts';
/** The outline drawn around another person's selection. */
export type OutlineOfOther = Pick<FlagToPlace, 'key' | 'box'>;
/** What of the drawn grid the name flags under the pointer depend on. */
export interface FlagsOfGrid {
  body: PaneRect;
  nameFlagsOfOthers: readonly NameFlagGroup[];
  outlinesOfOthers: readonly OutlineOfOther[];
  activeCellBox: BoxShownIn | null;
  marksOnChangesByAgent: readonly { name: PlacedFlag | null }[];
}
/** The flags the pointer is over, which give way to the cell under it. */
export interface FlagsHidden {
  corners: readonly string[];
  isOfAgent: boolean;
}
export interface FlagsAtPointer {
  cornerOnTop: string | null;
  cornersCalledUp: readonly string[];
  flagsHidden: FlagsHidden;
}
type FlagOverCell = Pick<NameFlagGroup, 'box' | 'stands' | 'end' | 'flagsWidth'>;
export function nameFlagOnTopAt(
  pointer: GridPoint,
  { body, nameFlagsOfOthers, outlinesOfOthers }: Pick<FlagsOfGrid, 'body' | 'nameFlagsOfOthers' | 'outlinesOfOthers'>,
): string | null {
  let point = {
    x: pointer.x - body.left,
    y: pointer.y - body.top,
  };
  if (
    nameFlagsOfOthers.length < 2 ||
    !isPointWithinBox(
      {
        ...body,
        left: 0,
        top: 0,
      },
      point,
    )
  )
    return null;
  let best: { outline: OutlineOfOther; corner: string } | null = null;
  for (let outline of outlinesOfOthers) {
    if (!isPointInShownBox(outline.box, point)) continue;
    let flagKey = nameFlagsOfOthers.find(({ outlineKeys }) => outlineKeys.includes(outline.key))?.key;
    if (flagKey === undefined) continue;
    if (best === null || outlineArea(outline) <= outlineArea(best.outline))
      best = {
        outline,
        corner: flagKey,
      };
  }
  return best?.corner ?? null;
}
export function pointedCellBox(pointer: GridPoint, state: PageState, reads: ReadsWithTextMeasurer): PaneRect | null {
  let stateForGrid = resetScrollForFreezeDrag(state);
  let layout = layoutOfView(stateForGrid, reads);
  let pointed = hitTestGrid(pointer, stateForGrid, layout);
  if (pointed?.kind !== 'cell') return null;
  let area = reads.mergedAreaAt(state.sheetId, pointed) ?? areaOfPosition(pointed);
  let box = drawnBoxOfSpans(rangeSpansOnScreen(area, stateForGrid, layout, stateForGrid));
  return box === null ? null : clipBoxToShown(box);
}
export function flagsHiddenByPointer(
  pointer: GridPoint,
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { body, activeCellBox, nameFlagsOfOthers, marksOnChangesByAgent }: Omit<FlagsOfGrid, 'outlinesOfOthers'>,
): FlagsHidden {
  let agentFlags = marksOnChangesByAgent.flatMap<FlagOverCell>(
    ({ name }) =>
      name === null
        ? []
        : [
            {
              ...name,
              end: 'left',
              flagsWidth: Math.min(name.box.width, AGENT_FLAG_WIDTH),
            },
          ],
  );
  if (nameFlagsOfOthers.length + agentFlags.length === 0) return NO_FLAGS_HIDDEN;
  let point = {
    x: pointer.x - body.left,
    y: pointer.y - body.top,
  };
  if (activeCellBox !== null && isPointWithinBox(clipBoxToShown(activeCellBox), point)) return NO_FLAGS_HIDDEN;
  let pointedBox = pointedCellBox(pointer, state, reads);
  if (pointedBox === null) return NO_FLAGS_HIDDEN;
  let isFlagOverCell = ({ box, stands, end, flagsWidth }: FlagOverCell) => {
    let { left, top, width, height } = growBoxByBorder(box);
    let flagLeft = end === 'left' ? left : left + width - flagsWidth;
    let topOfFlag = (
      {
        above: top - FLAG_HEIGHT,
        below: top + height,
        inside: top,
      }
    )[stands];
    let flagBox = {
      left: flagLeft + 1,
      top: topOfFlag + 1,
      width: flagsWidth - 1,
      height: FLAG_HEIGHT - 1,
    };
    let [shownLeft, shownTop] = [Math.max(flagBox.left, box.showsIn.left), Math.max(flagBox.top, box.showsIn.top)];
    let shownFlagBox = {
      left: shownLeft,
      top: shownTop,
      width: flagBox.left + flagBox.width - shownLeft,
      height: flagBox.top + flagBox.height - shownTop,
    };
    return doBoxesOverlap(shownFlagBox, pointedBox);
  };
  return {
    corners: nameFlagsOfOthers
      .filter((group) => isFlagOverCell(group) && !group.isAllThatShows)

      .map(({ key }) => key),
    isOfAgent: agentFlags.some(isFlagOverCell),
  };
}
export function nameFlagsCalledUpAt(
  pointer: GridPoint,
  { body, nameFlagsOfOthers, outlinesOfOthers }: Pick<FlagsOfGrid, 'body' | 'nameFlagsOfOthers' | 'outlinesOfOthers'>,
): string[] {
  let point = {
    x: pointer.x - body.left,
    y: pointer.y - body.top,
  };
  if (
    !isPointWithinBox(
      {
        ...body,
        left: 0,
        top: 0,
      },
      point,
    )
  )
    return [];
  let outlinesPointed = outlinesOfOthers.filter(({ box }) => isPointInShownBox(box, point));
  return nameFlagsOfOthers
    .filter(({ outlineKeys }) => outlinesPointed.some(({ key }) => outlineKeys.includes(key)))
    .map(({ key }) => key);
}
export const isPointWithinBox = ({ left, top, width, height }: PaneRect, { x, y }: GridPoint): boolean =>
  isInSpan(x, left, width) && isInSpan(y, top, height);
export const growBoxByBorder = ({ left, top, width, height }: PaneRect): PaneRect => ({
  left: left - 1,
  top: top - 1,
  width: width + 1,
  height: height + 1,
});
export const isPointInShownBox = (box: BoxShownIn, { x, y }: GridPoint): boolean =>
  isPointWithinBox(growBoxByBorder(box), {
    x,
    y,
  }) &&
  isPointWithinBox(box.showsIn, {
    x: Math.max(x, box.left),
    y: Math.max(y, box.top),
  });
export const outlineArea = ({ box }: Pick<OutlineOfOther, 'box'>): number => box.width * box.height;
export const NO_FLAGS_HIDDEN: FlagsHidden = {
  corners: [],
  isOfAgent: false,
};
export const doBoxesOverlap = (first: PaneRect, second: PaneRect): boolean =>
  first.left < second.left + second.width &&
  second.left < first.left + first.width &&
  first.top < second.top + second.height &&
  second.top < first.top + first.height;
export const presenceFlagsAtPointer = (
  pointer: GridPoint,
  state: PageState,
  reads: ReadsWithTextMeasurer,
  gridView: FlagsOfGrid,
): FlagsAtPointer => ({

  cornerOnTop: nameFlagOnTopAt(pointer, gridView),
  cornersCalledUp: nameFlagsCalledUpAt(pointer, gridView),
  flagsHidden: flagsHiddenByPointer(pointer, state, reads, gridView),
});
