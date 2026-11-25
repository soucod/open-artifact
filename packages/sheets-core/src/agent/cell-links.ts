/**
 * Cell links and walkthroughs. A cell link is the part of the page's address after `#` that names a tab and some of
 * its cells: `sheet-<sheetId>`, then each range after a `~`, its corners joined by `-` (`sheet-sht_ab.0~A2-D2~B1`).
 * Opening it shows that tab, brings the first range into view and marks every range. A walkthrough is a list of stops,
 * each a cell link and a short text, that the page steps the person through.
 *
 * A link's cells are places on the tab, as the agent reads them: rows and columns as they lie now, which is also how
 * they lie while the person sorts the tab for themself alone.
 */

import type { SheetWalkthrough } from '../protocol.ts';
import { AgentError } from './errors.ts';
import type { SheetView } from './workbook.ts';

/** A cell link read: the tab's id and its ranges, as A1 ranges (`A2:D2`, `B1`). */
export interface CellLink {
  sheetId: string;
  ranges: string[];
}

export const MAX_LINK_LENGTH = 128;
export const MAX_GUIDE_STOPS = 30;
export const MAX_STOP_TEXT = 600;

const LINK_PREFIX = 'sheet-';
const SHEET_ID = /^[A-Za-z0-9._-]+$/;
const CELL = '[A-Za-z]{1,3}[1-9][0-9]{0,6}';
const LINK_RANGE = new RegExp(`^(${CELL})(?:-(${CELL}))?$`);

/** The fragment that names a tab in a cell link. */
export const linkFragmentOf = (sheetId: string): string => `${LINK_PREFIX}${sheetId}`;

/** A cell link read, or null when the text is none. A link that names a tab and no cells is read with no ranges. */
export function parseCellLink(text: unknown): CellLink | null {
  if (typeof text !== 'string') return null;
  const fragment = text.startsWith('#') ? text.slice(1) : text;
  if (fragment.length > MAX_LINK_LENGTH) return null;
  const [tab = '', ...parts] = fragment.split('~');
  if (!tab.startsWith(LINK_PREFIX)) return null;
  const sheetId = tab.slice(LINK_PREFIX.length);
  if (!SHEET_ID.test(sheetId)) return null;
  const ranges: string[] = [];
  for (const part of parts) {
    const corners = LINK_RANGE.exec(part);
    if (!corners) return null;
    ranges.push(corners[2] ? `${corners[1]}:${corners[2]}`.toUpperCase() : corners[1]!.toUpperCase());
  }
  return { sheetId, ranges };
}

const GUIDE_SHAPE = `guide is {"stops": [{"at": "#sheet-<id>~A2-D2", "say": "…"}]}: from 1 to ${MAX_GUIDE_STOPS} stops, each a cell link with at least one range and a text of up to ${MAX_STOP_TEXT} characters.`;

/**
 * A walkthrough as showGuide gives it, checked against the workbook: each stop's tab must be one of `sheets` and its
 * ranges must lie within it. A walkthrough that is not well made is refused as unreadableRead.
 */
export function checkWalkthrough(guide: unknown, sheets: SheetView[]): SheetWalkthrough {
  if (typeof guide !== 'object' || guide === null || Array.isArray(guide)) throw new AgentError('unreadableRead', GUIDE_SHAPE);
  const { stops } = guide as { stops?: unknown };
  const keys = Object.keys(guide).filter((key) => key !== 'stops');
  if (keys.length) throw new AgentError('unreadableRead', `guide takes no "${keys[0]}": ${GUIDE_SHAPE}`, { key: keys[0] });
  if (!Array.isArray(stops) || stops.length < 1 || stops.length > MAX_GUIDE_STOPS) throw new AgentError('unreadableRead', GUIDE_SHAPE);
  return {
    stops: stops.map((stop: unknown, i: number) => {
      if (typeof stop !== 'object' || stop === null) throw new AgentError('unreadableRead', `stops[${i}] is {"at", "say"}.`);
      const { at, say } = stop as { at?: unknown; say?: unknown };
      const extra = Object.keys(stop).find((key) => key !== 'at' && key !== 'say');
      if (extra) throw new AgentError('unreadableRead', `stops[${i}] takes no "${extra}": its keys are at, say.`, { key: extra });
      const link = parseCellLink(at);
      if (typeof at !== 'string' || !link || link.ranges.length === 0) {
        throw new AgentError('unreadableRead', `stops[${i}].at is a cell link of at most ${MAX_LINK_LENGTH} characters with at least one range: "#sheet-<id>~A2-D2~B1", the id being the tab's linkFragment from readSheets.`);
      }
      if (typeof say !== 'string' || say.trim() === '' || say.length > MAX_STOP_TEXT) {
        throw new AgentError('unreadableRead', `stops[${i}].say is some plain text, of at most ${MAX_STOP_TEXT} characters.`);
      }
      const tab = sheets.find((s) => s.sheetId === link.sheetId);
      if (!tab) throw new AgentError('unknownSheetName', `stops[${i}].at names no tab of this Sheet: readSheets gives each tab's linkFragment.`, { linkFragment: linkFragmentOf(link.sheetId) });
      for (const range of link.ranges) tab.range(range, `stops[${i}].at`);
      return { at, say };
    }),
  };
}
