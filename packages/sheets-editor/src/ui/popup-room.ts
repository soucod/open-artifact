/** A stretch of the screen from top to foot, in pixels. */
export interface TopToFoot {
  top: number;
  foot: number;
}
export interface ViewportWithKeyboard {
  height: number;
  topOfPage: number;
  /** How much of the viewport the on-screen keyboard covers; 0 when it is down. */
  heightUnderKeyboard: number;
  topOfBarAtFoot: number;
  /** The root font size, in pixels. */
  rem: number;
}
export type PopupDirection = 'down' | 'up';
export function popupDirectionWithRoom(top: number, bounds: TopToFoot): PopupDirection | null {
  const [roomBelow, roomAbove] = [bounds.foot - top, top - 8 - bounds.top];
  if (roomBelow >= 332 || roomBelow >= roomAbove + 12) return 'down';
  return roomBelow < 308 && roomAbove > roomBelow + 12 && roomAbove >= 60 ? 'up' : null;
}
export function popupTopNearRow(row: TopToFoot, bounds: TopToFoot, height: number, heightAbove: number | null = null) {
  const topBelow = row.foot + 2;
  if (popupDirectionWithRoom(topBelow, bounds) === 'down') return topBelow - height;
  const topAbove = row.top - 2 + 4;
  if (popupDirectionWithRoom(topAbove + height, bounds) === 'up') return topAbove;
  if (heightAbove === null) return null;
  const bottomAbove = row.top - 2 - heightAbove;
  const topAboveAll = bottomAbove - height;
  return topAboveAll >= bounds.top + 12 && popupDirectionWithRoom(bottomAbove, bounds) === 'down' ? topAboveAll : null;
}
export const boundsAboveKeyboard = (viewport: ViewportWithKeyboard): TopToFoot => ({
  top: viewport.topOfPage,
  foot:
    viewport.heightUnderKeyboard > 0
      ? viewport.height - viewport.heightUnderKeyboard
      : viewport.height -
        Math.max(
          0,
          Math.min(viewport.height - viewport.topOfBarAtFoot + 8, 120 * Math.max(1, viewport.rem / 16), viewport.height - viewport.topOfPage - 240),
        ),
});
