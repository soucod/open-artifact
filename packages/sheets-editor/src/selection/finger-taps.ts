import type { GridPoint, PaneRect } from '../grid/geometry.ts';
import { clipBoxToShown } from '../grid/view-boxes.ts';
/** A box on the grid, and the part of the grid it shows in. */
export interface BoxShownIn extends PaneRect {
  showsIn: PaneRect;
}
/** A column header as drawn, across the grid's body. */
export interface ColumnHeaderToTap {
  key: string;
  left: number;
  width: number;
}
/** A row as drawn, down the grid's body. */
export interface RowToTap {
  key: string;
  top: number;
  height: number;
}
/** What of the grid as drawn a tap is found on and told by. */
export interface GridToTap {
  body: Pick<PaneRect, 'left' | 'top'>;
  activeCellBox: BoxShownIn | null;
  activeCellElementId: string | null;
  columnHeaders: readonly ColumnHeaderToTap[];
  rows: readonly RowToTap[];
  fillHandleBox: PaneRect | null;
  isFillHandleHeld: boolean;
  isFillHandleOnlyTouched: boolean;
  isFingerSelecting: boolean;
  isTapYetToBeTold: boolean;
}
/** A tap on the grid, and the spot of the grid it is on. */
export interface TapOnGrid {
  on: string | null;
}
/** The last tap, where it was and when it ended. */
export interface LastTap {
  endedAtMs: number;
  on: string;
}
/** A finger down on the grid, and whether it is the second tap of two. */
export interface TapDown {
  pointerId: number;
  on: string | null;
  at: GridPoint;
  sinceMs: number;
  isSecond: boolean;
  isUnhurried: boolean;
  liftedAtMs: number | null;
}
/** The taps being followed: the last one, and the finger down now. */
export interface Taps {
  last: LastTap | null;
  down: TapDown | null;
}
/** A press of a finger on the grid, to follow as a tap. */
export interface PressToTap {
  pointerId: number;
  atMs: number;
  at: GridPoint;
  on: string | null;
  hasPersonActedSinceLast?: boolean;
}
/** The taps once a finger is lifted, and where the grid was pressed twice when it was. */
export interface TapsSettled {
  taps: Taps;
  pressedTwiceAt: GridPoint | null;
}
export function gridSpotAt({ x, y }: GridPoint, grid: GridToTap): string | null {
  let { body, activeCellBox, activeCellElementId } = grid;
  let [xInBody, yInBody] = [x - body.left, y - body.top];
  if (xInBody < 0 && yInBody < 0) return 'corner';
  if (yInBody < 0) {
    let match = grid.columnHeaders.find(({ left, width }: ColumnHeaderToTap) => xInBody >= left && xInBody < left + width);
    return match === undefined ? null : `column ${match.key}`;
  }
  if (xInBody < 0) {
    let match = grid.rows.find(({ top, height }: RowToTap) => yInBody >= top && yInBody < top + height);
    return match === undefined ? null : `row ${match.key}`;
  }
  if (activeCellBox === null) return null;
  let { left: cellLeft, top: cellTop, width: cellWidth, height: cellHeight } = clipBoxToShown(activeCellBox);
  return xInBody >= cellLeft && xInBody < cellLeft + cellWidth && yInBody >= cellTop && yInBody < cellTop + cellHeight ? activeCellElementId : null;
}
export function tapOnGrid(point: GridPoint, grid: GridToTap): TapOnGrid | null {
  let { body, fillHandleBox } = grid;
  let [xInHandle, yInHandle] = [point.x - body.left - (fillHandleBox?.left ?? 0), point.y - body.top - (fillHandleBox?.top ?? 0)];
  let isOnFillHandle =
    fillHandleBox !== null && xInHandle >= 0 && xInHandle < fillHandleBox.width && yInHandle >= 0 && yInHandle < fillHandleBox.height;
  if (!mayTapBeTold(grid) || (isOnFillHandle && !grid.isTapYetToBeTold)) return null;
  return grid.isFillHandleOnlyTouched || grid.isTapYetToBeTold
    ? {
        on: gridSpotAt(point, grid),
      }
    : null;
}
export function tapsAfterPress({ last }: Pick<Taps, 'last'>, press: PressToTap | null): Taps {
  if (press === null) return NO_TAPS;
  let { pointerId, atMs, at, on, hasPersonActedSinceLast = false } = press;
  let sinceLast = last !== null && last.on === on ? atMs - last.endedAtMs : 1 / 0;
  let mayBeUnhurried = on?.startsWith('cell-') === true && !hasPersonActedSinceLast;
  let isSecond = sinceLast <= (mayBeUnhurried ? UNHURRIED_DOUBLE_TAP_GAP_MS : DOUBLE_TAP_GAP_MS);
  let isUnhurried = isSecond && sinceLast > DOUBLE_TAP_GAP_MS;
  return {
    last: null,
    down: {
      pointerId,
      on,
      at,
      sinceMs: atMs,
      isSecond,
      isUnhurried,
      liftedAtMs: null,
    },
  };
}
export function tapsAfterLift({ down }: Pick<Taps, 'down'>, pointerId: number, liftedAtMs: number | null): Taps {
  if (down?.pointerId !== pointerId || liftedAtMs === null) return NO_TAPS;
  return liftedAtMs - down.sinceMs > TAP_HOLD_LIMIT_MS
    ? NO_TAPS
    : {
        last: null,
        down: {
          ...down,
          liftedAtMs,
        },
      };
}
export function settleTaps(taps: Taps, pointerId: number, spotAt: (point: GridPoint) => string | null): TapsSettled {
  let { down } = taps;
  if (down?.pointerId !== pointerId)
    return {
      taps,
      pressedTwiceAt: null,
    };
  if (down.liftedAtMs === null)
    return {
      taps: NO_TAPS,
      pressedTwiceAt: null,
    };
  let tappedOn = down.on ?? spotAt(down.at);
  let lastTap: LastTap | null =
    tappedOn === null
      ? null
      : {
          endedAtMs: down.liftedAtMs,
          on: tappedOn,
        };
  if (!down.isSecond)
    return {
      taps: {
        last: lastTap,
        down: null,
      },
      pressedTwiceAt: null,
    };
  return {
    taps: down.isUnhurried
      ? {
          last: lastTap,
          down: null,
        }
      : NO_TAPS,
    pressedTwiceAt: spotAt(down.at) === down.on ? down.at : null,
  };
}
export const DOUBLE_TAP_GAP_MS = 300;
export const UNHURRIED_DOUBLE_TAP_GAP_MS = 2000;
export const TAP_SLOP_PX = 24;
export const TAP_HOLD_LIMIT_MS = 450;
export const TAP_TOTAL_MS = TAP_HOLD_LIMIT_MS + DOUBLE_TAP_GAP_MS;
export const NO_TAPS: Taps = {
  last: null,
  down: null,
};
export const mayTapBeTold = ({
  isFillHandleHeld,
  isFillHandleOnlyTouched,
  isFingerSelecting,
  isTapYetToBeTold,
}: Pick<GridToTap, 'isFillHandleHeld' | 'isFillHandleOnlyTouched' | 'isFingerSelecting' | 'isTapYetToBeTold'>): boolean => (!isFillHandleHeld || isFillHandleOnlyTouched) && (!isFingerSelecting || isTapYetToBeTold);
export const isTapOnGrid = (point: GridPoint, grid: GridToTap): boolean => tapOnGrid(point, grid) !== null;
export const SOON_AFTER_CELL_TAP_MS = 500;
export const isSoonAfterCellTap = ({ last }: Pick<Taps, 'last'>, atMs: number): boolean =>
  last?.on.startsWith('cell-') === true && atMs - last.endedAtMs <= SOON_AFTER_CELL_TAP_MS;
export const tapsPressedOnLastTap = ({ last }: Pick<Taps, 'last'>, { pointerId, atMs, at }: Pick<PressToTap, 'pointerId' | 'atMs' | 'at'>): Taps =>
  last === null
    ? NO_TAPS
    : {
        last: null,
        down: {
          pointerId,
          on: last.on,
          at,
          sinceMs: atMs,
          isSecond: false,
          isUnhurried: false,
          liftedAtMs: null,
        },
      };
