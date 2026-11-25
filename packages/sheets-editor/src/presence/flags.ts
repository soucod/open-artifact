import { isInSpan, type PaneRect } from '../grid/geometry.ts';
import type { TextAlignment } from '../grid/cell-metrics.ts';
import type { BoxShownIn } from '../selection/finger-taps.ts';
import type { PeerFlagLook } from './selections.ts';
/** Where a name flag stands against the box it names. */
export type FlagStands = 'above' | 'below' | 'inside';
/** The end of the box a row of name flags is lined up with. */
export type FlagEnd = 'left' | 'right';
/** What a name flag needs to know about the area it names. */
export interface FlagRoom {
  roomAbove: number;
  isOneCell: boolean;
  widthOfAll: number;
  heightOfAll: number;
  heightCovered: number;
}
export interface FlagRoomAndWidth extends FlagRoom {
  flagWidth: number;
}
export interface PlacedFlag {
  stands: FlagStands;
  box: BoxShownIn;
}
/** Another person's selection, to be named by a flag. */
export interface FlagToPlace extends FlagRoom, PeerFlagLook {
  key: string;
  userId: string;
  box: BoxShownIn;
  movedAtMs: number;
  isUnderOwnOutline: boolean;
}
export interface NameFlag extends PeerFlagLook {
  key: string;
}
/** Name flags at one corner, drawn as one row. */
export interface NameFlagGroup extends PlacedFlag {
  key: string;
  outlineKeys: string[];
  lastMoveAtMs: number;
  isAllThatShows: boolean;
  end: FlagEnd;
  flags: NameFlag[];
  countFolded: number;
  flagsWidth: number;
}
/** A drawn cell, as far as a flag over it cares. */
export interface CellUnderFlag extends PaneRect {
  text: string;
  checkbox: { isChecked: boolean } | null;
  alignment: TextAlignment;
}
export interface RowUnderFlags {
  top: number;
  cells: readonly CellUnderFlag[];
}
interface FlagsAtEdge {
  stands: FlagStands;
  edge: string;
  atCorner: FlagToPlace[];
  outlineKeys: string[];
  lastMoveAtMs: number;
  isAllThatShows: boolean;
  areAllAsWide: boolean;
  areAllHeld: boolean;
}
export function estimateCharWidth(char: string): number {
  if (/\p{Extended_Pictographic}/u.test(char)) return 16;
  if (WIDE_CHAR_PATTERN.test(char) || /[MWmw]/.test(char)) return 11;
  if (/\p{Lu}/u.test(char)) return 8;
  return /[filjtr .’'-]/u.test(char) ? 3.5 : 6;
}
export function estimateTextWidth(text: string): number {
  let width = 0;
  for (let char of text) width += estimateCharWidth(char);
  return width;
}
export function flagStandOutside(box: BoxShownIn, bottomLimit: number, topLimit: number): Exclude<FlagStands, 'inside'> | null {
  let { left, top, height, showsIn } = box;
  if (left < showsIn.left) return null;
  if (top - 1 - flagRoomTop(box, topLimit) >= FLAG_HEIGHT) return 'above';
  let bottom = top + height;
  return bottom <= showsIn.top + showsIn.height && bottom + FLAG_HEIGHT <= bottomLimit ? 'below' : null;
}
export function placeSelectionFlag(
  box: BoxShownIn,
  { flagWidth, roomAbove, isOneCell, heightCovered = 0, ...sizes }: FlagRoomAndWidth,
  bottomLimit: number,
  topOfView: number,
): PlacedFlag | null {
  let coveredOffset = box.showsIn.top < topOfView ? 0 : heightCovered;
  let topLimit = topOfView + coveredOffset;
  let boxBelowCovered = {
    ...box,
    showsIn: {
      ...box.showsIn,
      top: box.showsIn.top + coveredOffset,
      height: box.showsIn.height - coveredOffset,
    },
  };
  let { top, height, showsIn } = boxBelowCovered;
  let isPastLeft = boxBelowCovered.left < showsIn.left;
  if (isPastLeft && isFlagPastEdge(boxRight(boxBelowCovered), showsIn, flagWidth)) return null;
  let left = isPastLeft
    ? Math.min(showsIn.left + 1, boxRight(boxBelowCovered) - flagLeftInset(flagWidth, sizes.widthOfAll))
    : boxBelowCovered.left;
  let flagBox = {
    ...boxBelowCovered,
    left,
    width: boxRight(boxBelowCovered) - left,
  };
  let outside = flagStandOutside(
    {
      ...flagBox,
      left: Math.max(left, showsIn.left),
    },
    bottomLimit,
    topLimit,
  );
  if (outside === 'above')
    return {
      stands: 'above',
      box: flagBox,
    };
  let roomTop = flagRoomTop(boxBelowCovered, topLimit);
  let bottom = top + height;
  let heightInside = Math.min(bottom, showsIn.top + showsIn.height, bottomLimit) - Math.max(top, roomTop);
  let isTopHidden = top < roomTop && sizes.heightOfAll >= FLAG_INSIDE_MIN_HEIGHT;
  if (!isOneCell && (heightInside >= FLAG_INSIDE_MIN_HEIGHT || isTopHidden) && (roomAbove > FLAG_HEIGHT || outside === null)) {
    let insideTop = Math.min(roomTop + 1, bottom - FLAG_HEIGHT);
    return {
      stands: 'inside',
      box: {
        ...flagBox,
        top: insideTop,
        height: bottom - insideTop,
      },
    };
  }
  return outside === null
    ? null
    : {
        stands: outside,
        box: flagBox,
      };
}
export function cellBoxAt(x: number, y: number, rows: readonly RowUnderFlags[]): CellUnderFlag | null {
  for (let row of rows)
    for (let cell of row.cells) if (isInSpan(x, cell.left, cell.width) && isInSpan(y, row.top + cell.top, cell.height)) return cell;
  return null;
}
export function flagEndForBox(
  { stands, box: { left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight, showsIn } }: PlacedFlag,
  shownCells: readonly RowUnderFlags[],
): FlagEnd {
  if (boxLeft + boxWidth > showsIn.left + showsIn.width) return 'left';
  let edgeRow = (
    {
      above: boxTop - 2,
      below: boxTop + boxHeight,
      inside: boxTop,
    }
  )[stands];
  let edgeCells = [cellBoxAt(boxLeft, edgeRow, shownCells), cellBoxAt(boxLeft + boxWidth - 2, edgeRow, shownCells)];
  let areEdgeCellsEmpty = edgeCells.every((cell) => cell?.text === '' && cell.checkbox === null);
  let [leftCell, rightCell] = areEdgeCellsEmpty ? [cellBoxAt(boxLeft, boxTop, shownCells), null] : edgeCells;
  return flagSideOfCellAlignment(leftCell) === 'left' && flagSideOfCellAlignment(rightCell) !== 'right' ? 'right' : 'left';
}
export function layOutSelectionFlags(
  flagRequests: readonly FlagToPlace[],
  viewHeight: number,
  topInset: number,
  shownCells: readonly RowUnderFlags[],
): NameFlagGroup[] {
  let flagsByEdge = new Map<string, FlagsAtEdge>();
  for (let request of flagRequests) {
    let placed = placeSelectionFlag(
      request.box,
      {
        ...request,
        flagWidth: 0,
      },
      viewHeight,
      topInset,
    );
    if (placed === null) continue;
    let { stands, box } = placed;
    let shownFlag = {
      ...request,
      box,
    };
    let edge = `${stands} ${stands === 'below' ? box.top + box.height : box.top}`;
    let edgeKey = `${edge} ${Math.max(request.box.left, box.showsIn.left)}`;
    let existing = flagsByEdge.get(edgeKey);
    let { atCorner = [], outlineKeys = [] }: Partial<FlagsAtEdge> = existing ?? {};
    let isUserAlreadyAtCorner = atCorner.some(({ userId }) => userId === shownFlag.userId);
    flagsByEdge.set(edgeKey, {
      stands,
      edge,
      atCorner: isUserAlreadyAtCorner ? atCorner : [...atCorner, shownFlag],
      outlineKeys: [...outlineKeys, shownFlag.key],
      lastMoveAtMs: Math.max(existing?.lastMoveAtMs ?? 0, shownFlag.movedAtMs),
      isAllThatShows: existing?.isAllThatShows === true || shownFlag.isUnderOwnOutline,
      areAllAsWide: atCorner.every((other) => boxRight(other.box) === boxRight(box)) && existing?.areAllAsWide !== false,
      areAllHeld: box.left > request.box.left && existing?.areAllHeld !== false,
    });
  }
  let flagGroups = [...flagsByEdge.values()].flatMap(({ areAllHeld, atCorner, ...group }) => {
    let [first, ...rest] = atCorner;
    if (first === undefined || !areAllHeld)
      return [
        {
          ...group,
          atCorner,
        },
      ];
    let rightEdge = Math.max(...atCorner.map(({ box }) => boxRight(box)));
    if (isFlagPastEdge(rightEdge, first.box.showsIn, flagWidthOf(first.name))) return [];
    let widestFlagRow = Math.max(...atCorner.map(({ widthOfAll }) => widthOfAll));
    let left = Math.min(first.box.left, rightEdge - flagLeftInset(flagWidthOf(first.name), widestFlagRow));
    let heldBox = {
      ...first.box,
      left,
      width: boxRight(first.box) - left,
    };
    return [
      {
        ...group,
        atCorner: [
          {
            ...first,
            box: heldBox,
          },
          ...rest,
        ],
      },
    ];
  });
  return flagGroups.flatMap(({ atCorner, edge, areAllAsWide, ...group }) => {
    let [first] = atCorner;
    if (first === undefined) return [];
    let width = Math.max(...atCorner.map(({ box: flagBox }) => boxRight(flagBox))) - first.box.left;
    let box = {
      ...first.box,
      width,
    };
    let isEdgeFree = !flagGroups.some(
      (other) => other.edge === edge && isInSpan(other.atCorner[0]?.box.left ?? box.left, box.left + 1, width - 1),
    );
    let runningWidth = 0;
    let flagEnds = atCorner.map(({ name }) => (runningWidth += flagWidthOf(name)));
    let fitsWithBadge = (flagEnd: number, index: number) =>
      index === 0 || flagEnd + moreBadgeWidth(atCorner.length - index - 1) <= width;
    let shownCount = runningWidth <= width ? atCorner.length : flagEnds.filter(fitsWithBadge).length;
    let shownFlags = atCorner.slice(0, shownCount);
    let foldedCount = atCorner.length - shownFlags.length;
    let badgeWidth = foldedCount > 0 ? moreBadgeWidth(foldedCount) : 0;
    return [
      {
        key: first.key,
        box,
        ...group,
        end:
          areAllAsWide && isEdgeFree
            ? flagEndForBox(
                {
                  stands: group.stands,
                  box,
                },
                shownCells,
              )
            : 'left',
        flags: shownFlags.map(
          ({ key, name, color, inkColor }) => ({
            key,
            name,
            color,
            inkColor,
          }),
        ),
        countFolded: foldedCount,
        flagsWidth: Math.max(Math.min(width, (flagEnds[shownCount - 1] ?? 0) + badgeWidth), foldedCount > 0 ? 2 * FLAG_PADDING + badgeWidth : 0),
      },
    ];
  });
}
export const PEER_FLAG_REST_AFTER_MS = 3200;
export const FLAG_HEIGHT = 18;
export const FLAG_PADDING = 6;
export const FLAG_BORDER = 1;
export const MORE_BADGE_PADDING = 3;
export const FLAG_MAX_WIDTH = 240;
export const WIDE_CHAR_PATTERN = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Hangul}\u3000\uFF01-\uFF60]/u;
export const flagWidthOf = (flagName: string): number =>
  Math.min(2 * FLAG_PADDING + estimateTextWidth(flagName), FLAG_MAX_WIDTH) + FLAG_BORDER;
export const moreBadgeWidth = (count: number): number => MORE_BADGE_PADDING + estimateTextWidth(`+${count}`);
export const AGENT_FLAG_WIDTH = flagWidthOf('Agent');
export const flagRoomTop = ({ top, showsIn }: Pick<BoxShownIn, 'top' | 'showsIn'>, topLimit: number): number =>
  top < topLimit ? showsIn.top : Math.max(showsIn.top, topLimit);
export const FLAG_INSIDE_MIN_HEIGHT = 2 * FLAG_HEIGHT;
export const boxRight = ({ left, width }: Pick<PaneRect, 'left' | 'width'>): number => left + width;
export const FLAG_LEFT_SLACK = 6;
export const flagLeftInset = (flagWidth: number, widthOfAll: number): number => Math.min(flagWidth + FLAG_LEFT_SLACK, widthOfAll);
export const isFlagPastEdge = (right: number, { left, width }: Pick<PaneRect, 'left' | 'width'>, flagWidth: number): boolean =>
  right > left + width && width < flagWidth;
export const flagTop = ({ stands, box: { top, height } }: PlacedFlag): number =>
  (
    {
      above: top - FLAG_HEIGHT,
      below: top + height,
      inside: top,
    }
  )[stands];
export const flagSideOfCellAlignment = (cell: CellUnderFlag | null): FlagEnd | null =>

  cell === null || cell.text === '' || cell.alignment === 'center' ? null : cell.alignment;
