/**
 * Which table, when one is too wide for the page and too tall for the window, gets a scrollbar held at the foot of
 * the window, and where that bar goes. Boxes are in the window's coordinates.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** A table's scrolling wrapper as the page draws it. */
export interface ScrollingTable {
  box: Box;
  /** Left and right of what it shows of its table, inside its padding. */
  shownLeft: number;
  shownRight: number;
  /** How far it scrolls sideways (its scroll width less its width). */
  overflow: number;
}

/** The docked bar: the table it moves, where it lies, and how wide its track is, so both scroll the same distance. */
export interface DockPlace {
  index: number;
  left: number;
  width: number;
  track: number;
}

/** Least height of a table above the bar for the bar to come; less, and the table is about to leave the window. */
export const DOCK_MIN_SHOWN = 40;
/** Narrower than this, a bar is no use. */
export const DOCK_MIN_WIDTH = 48;

/**
 * The table whose own scrollbar is below the window while some of it is in the window, the lowest such when there are
 * several, and the bar's place over the part of it in sight: null when no table needs one.
 */
export function dockFor(tables: readonly ScrollingTable[], window: Box, barHeight: number): DockPlace | null {
  let chosen = -1;
  for (const [index, table] of tables.entries()) {
    const { box, overflow } = table;
    if (overflow <= 1 || box.bottom <= box.top) continue;
    if (box.bottom <= window.bottom) continue;
    if (box.top > window.bottom - barHeight - DOCK_MIN_SHOWN) continue;
    if (chosen === -1 || box.top > tables[chosen]!.box.top) chosen = index;
  }
  if (chosen === -1) return null;
  const table = tables[chosen]!;
  const left = Math.max(table.shownLeft, window.left);
  const width = Math.min(table.shownRight, window.right) - left;
  if (width < DOCK_MIN_WIDTH) return null;
  return { index: chosen, left, width, track: width + table.overflow };
}

/** Whether two places draw the same bar. */
export function samePlace(a: DockPlace | null, b: DockPlace | null): boolean {
  if (!a || !b) return a === b;
  return a.index === b.index && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.track - b.track) < 0.5;
}
