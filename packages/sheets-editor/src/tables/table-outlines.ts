import { layoutOfView } from '../grid/layout.ts';
import { rangeSpansOnScreen, frozenColumnsWidth, frozenRowsHeight } from '../grid/geometry.ts';
import { cutSidesOfTableSpans } from './table-drawing.ts';
import { drawnOwnFiltersOfSheet, ownFilterNotDrawnYet } from './own-filters.ts';
import { areaOfFilteredTable } from './finding.ts';
import { isAreaWithin } from '../selection/several-ranges.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { ColumnId, RowId } from '@open-artifact/sheets-core';
import type { PageState } from '../state/initial-state.ts';
import type { OwnFilter } from './own-filters.ts';
import type { CellArea } from '../selection/model.ts';
import type { GridPoint, PaneRect, SpanOnScreen } from '../grid/geometry.ts';
import type { OutlinableTable } from './tables-in-view.ts';
import type { PlacedFilterButton } from './table-drawing.ts';
/** A table to outline: its key, its area (`null` when it cannot be placed), and what else its outline carries. */
export interface TableToOutlineIn<More> {
  key: string;
  where: CellArea | null;
  more: More;
}
/** The outline of a table on the grid, clipped to the panes, with how far it is cut at its left and top and the frozen lines over it. */
export interface TableOutline {
  tableKey: string;
  left: number;
  top: number;
  width: number;
  height: number;
  cutAtLeft: number;
  cutAtTop: number;
  frozenAcross: number;
  frozenDown: number;
  sidesCut: string | null;
  isAtRowNumbers: boolean;
  isAtColumnLetters: boolean;
}
/** The outline of a table found in sight, and whether it is held back for the agent's change. */
export interface FoundTableOutline extends TableOutline, Pick<OutlinableTable, 'comesLater'> {}
/** What the grid holds that places a table's card: the cells' box, the outlines of filtered tables, and the filter buttons. */
export interface GridWithTableOutlines {
  body: Pick<PaneRect, 'left' | 'top' | 'width'>;
  filteredTableOutlines: readonly TableOutline[];
  outlineOfFilterNotDrawnYet?: TableOutline | null;
  filterButtons?: readonly Pick<PlacedFilterButton, 'isOfFoundTable' | 'isListOpen' | 'cell' | 'r' | 'c'>[];
}
/** The filter button a table's card hangs by: the height of the row under it, and the button by its row and column. */
export interface CardByButton {
  underRowOfHeight: number | null;
  cell: string;
}
/** Where a table's card is placed beside it, and the button it hangs by, if any. */
export interface TableCardPlacement extends GridPoint {
  byButton: CardByButton | null;
}
/** Where a card hangs from: the top it is anchored at, and the height of the row it hangs under (`null`: level with it). */
export interface HungAt {
  y: number;
  underRowOfHeight: number | null;
}
/** Whether a hung card sits over the row it hangs from, under it, or level with it. */
export type HungCardWhere = 'over' | 'under' | 'level';
/** Where a hung card is fitted: its top, how it sits by its row, and the room it keeps clear at the foot. */
export interface HungCardPlace {
  y: number;
  where: HungCardWhere;
  clearAtFoot: number;
}
/** How a hung card was last fitted, and whether it was drawn or stepped from its first card since. */
export interface HungCardState {
  hungAt: HungAt | null;
  ofFirst: HungCardPlace | null;
  place: HungCardPlace | null;
  isFirst: boolean;
  isDrawnSince: boolean;
  hasStepped: boolean;
  fittedTo: number;
}
/** A hung card fitted anew, which has a place. */
export interface RefittedHungCard extends HungCardState {
  place: HungCardPlace;
}
/** The table a card was last hung for, and the filter button it hung by. */
export interface CardHungFor {
  tableKey: string;
  cellOfButton: string | null;
}
/** The top a card open beside a table is kept at. */
export interface CardOpenPlace {
  y: number;
  isCardOpen: boolean;
}
/** The filter button whose list hangs under it, and where it is on the page. */
export interface FilterButtonToHangFrom {
  tableKey: string;
  c: ColumnId;
  hangsFrom: GridPoint & Pick<PaneRect, 'height'>;
}
/** A card hung under a filter button: where it hangs, whose it is, and the button. */
export interface HungUnderFilterButton extends GridPoint {
  whose: string;
  byButton: CardByButton;
}
export function clipOutlineSpan(span: SpanOnScreen): [number, number, number] | null {
  let { start, end, showFrom, showTo } = span;
  if (end <= start || end <= showFrom || start >= showTo) return null;
  let from = Math.max(start, showFrom - OUTLINE_OVERHANG);
  return [from, Math.min(end, showTo + OUTLINE_OVERHANG), isSpanAtHeaders(span) ? -OUTLINE_OVERHANG : Math.max(showFrom - from, -OUTLINE_OVERHANG)];
}
export function tableOutlinesOf<More extends object>(
  tables: readonly TableToOutlineIn<More>[],
  view: PageState,
  reads: ReadsWithTextMeasurer,
): (TableOutline & More)[] {
  if (tables.length === 0) return NO_TABLE_OUTLINES;
  let layout = layoutOfView(view, reads);
  return tables.flatMap(({ key, where, more }): (TableOutline & More)[] => {
    let spans = where === null ? null : rangeSpansOnScreen(where, view, layout, view);
    let [across, down] = spans === null ? [null, null] : [clipOutlineSpan(spans.across), clipOutlineSpan(spans.down)];
    if (across === null || down === null) return [];
    let [[leftX, rightX, cutAtLeft], [topY, bottomY, cutAtTop]] = [across, down];
    let sidesCut = spans === null ? [] : cutSidesOfTableSpans(spans, layout);
    return [
      {
        tableKey: key,
        left: leftX,
        top: topY,
        width: rightX - leftX,
        height: bottomY - topY,
        cutAtLeft,
        cutAtTop,
        frozenAcross: (view.scrollLeft === 0 ? 0 : frozenColumnsWidth(layout)) - leftX,
        frozenDown: (view.scrollTop === 0 ? 0 : frozenRowsHeight(layout)) - topY,
        sidesCut: sidesCut.length === 0 ? null : sidesCut.join(' '),
        isAtRowNumbers: spans !== null && isSpanAtHeaders(spans.across),
        isAtColumnLetters: spans !== null && isSpanAtHeaders(spans.down),
        ...more,
      },
    ];
  });
}
export function tableCardPlacement(
  {
    body,
    filteredTableOutlines: outlinesOfFilteredTables,
    outlineOfFilterNotDrawnYet: outlineNotDrawnYet = null,
    filterButtons = [],
  }: GridWithTableOutlines,
  tableKey: string | null,
  zoom: number = 1,
  cardWidth: number = 0,
): TableCardPlacement | null {
  let outline =
    outlineNotDrawnYet?.tableKey === tableKey
      ? outlineNotDrawnYet
      : outlinesOfFilteredTables.find((filteredOutline) => filteredOutline.tableKey === tableKey);
  if (outline === undefined) return null;
  let gap = TABLE_CARD_GAP / zoom;
  let openButton =
    outline === outlineNotDrawnYet
      ? filterButtons.find(({ isOfFoundTable, isListOpen }) => isOfFoundTable && isListOpen)
      : undefined;
  let x = Math.max(outline.left + outline.width, (openButton?.cell.left ?? 0) + (openButton?.cell.width ?? 0)) + gap;
  let fitsBeside = x + cardWidth / zoom + gap <= body.width;
  let y = openButton === undefined ? 0 : body.top + openButton.cell.top + (fitsBeside ? -gap : openButton.cell.height);
  return {
    x: body.left + Math.min(x, body.width - gap),
    y,
    byButton:
      openButton === undefined
        ? null
        : {
            underRowOfHeight: fitsBeside ? null : openButton.cell.height,
            cell: `${openButton.r} ${openButton.c}`,
          },
  };
}
export function fitHungCardVertically(
  hungAt: HungAt,
  cardHeight: number,
  windowHeight: number,
  previous: HungCardPlace | null,
  topAtLeast: number = Number.NEGATIVE_INFINITY,
): HungCardPlace {
  let topLimit = Math.max(TABLE_CARD_MARGIN - TABLE_CARD_GAP, topAtLeast);
  let bottomLimit = windowHeight - TABLE_CARD_MARGIN - cardHeight - TABLE_CARD_GAP;
  let rowTop = hungAt.y - (hungAt.underRowOfHeight ?? 0) - TABLE_CARD_GAP;
  let overY = rowTop - cardHeight - TABLE_CARD_GAP;
  let clearAtFoot = Math.max(0, windowHeight - rowTop - TABLE_CARD_MARGIN);
  let place: HungCardPlace = previous ?? {
    y: hungAt.y,
    where: hungAt.underRowOfHeight === null ? 'level' : 'under',
    clearAtFoot: 0,
  };
  if (place.where === 'over')
    return {
      y: Math.min(place.y, Math.max(Math.min(overY, bottomLimit), topLimit)),
      where: 'over',
      clearAtFoot,
    };
  if (place.y <= bottomLimit) return place;
  if (place.where === 'under') {
    let hasRoomUnder = windowHeight - hungAt.y >= TABLE_CARD_MIN_ROOM;
    if (previous !== null && hasRoomUnder) return place;
    let fitsAbove = isClearOfFoot(rowTop, windowHeight);
    if (fitsAbove && overY >= topLimit)
      return {
        y: overY,
        where: 'over',
        clearAtFoot,
      };
    if (hasRoomUnder) return place;
    if (fitsAbove && rowTop - topLimit - TABLE_CARD_GAP >= TABLE_CARD_MIN_ROOM)
      return {
        y: topLimit,
        where: 'over',
        clearAtFoot,
      };
  }
  return {
    y: Math.min(place.y, Math.max(bottomLimit, topLimit)),
    where: 'level',
    clearAtFoot: 0,
  };
}
export function refitHungCard(
  state: HungCardState,
  windowHeight: number,
  measureCardHeight: () => number,
  topAtLeast: number | undefined,
): RefittedHungCard | null {
  if (state.hungAt === null || (!state.isDrawnSince && windowHeight >= state.fittedTo)) return null;
  let previous = state.isDrawnSince ? state.ofFirst : state.place;
  let place = fitHungCardVertically(state.hungAt, measureCardHeight(), windowHeight, previous, topAtLeast);
  return {
    ...state,
    ofFirst: state.isFirst ? place : state.ofFirst,
    place,
    isDrawnSince: false,
    fittedTo: windowHeight,
  };
}
export function keepCardOpenPlace(previous: CardOpenPlace | null, isCardOpen: boolean, y: number): CardOpenPlace | null {
  if (previous === null)
    return isCardOpen
      ? {
          y,
          isCardOpen,
        }
      : null;
  if (previous.isCardOpen === isCardOpen) return previous;
  return {
    y: isCardOpen ? y : previous.y,
    isCardOpen,
  };
}
export const OUTLINE_OVERHANG = 32;
export const isSpanAtHeaders = ({ start, showFrom }: Pick<SpanOnScreen, 'start' | 'showFrom'>): boolean => start === 0 && showFrom === 0;
export const isAreaInFilteredTable = (view: PageState, reads: WorkbookReads, area: CellArea): boolean =>
  drawnOwnFiltersOfSheet(view, view.sheetId).some((ownFilter: OwnFilter) => {
    let filteredArea = areaOfFilteredTable(reads, ownFilter);
    return filteredArea !== null && isAreaWithin(area, filteredArea);
  });
export const NO_TABLE_OUTLINES: never[] = [];
export const filteredTableOutlines = (view: PageState, reads: ReadsWithTextMeasurer): TableOutline[] =>
  tableOutlinesOf(
    drawnOwnFiltersOfSheet(view, view.sheetId).map(
      (ownFilter: OwnFilter): TableToOutlineIn<{}> => ({
        key: ownFilter.key,
        where: areaOfFilteredTable(reads, ownFilter),
        more: {},
      }),
    ),
    view,
    reads,
  );
export const outlineOfFilterNotDrawnYet = (view: PageState, reads: ReadsWithTextMeasurer): TableOutline | null =>
  tableOutlinesOf(
    [ownFilterNotDrawnYet(view)].flatMap(
      (ownFilter: OwnFilter | null): TableToOutlineIn<{}>[] =>
        ownFilter === null
          ? []
          : [
              {
                key: ownFilter.key,
                where: areaOfFilteredTable(reads, ownFilter),
                more: {},
              },
            ],
    ),
    view,
    reads,
  )[0] ?? null;
export const TABLE_CARD_GAP = 6;
export const isCardHungAnew = (lastHung: CardHungFor | null, tableKey: string, byButton: Pick<CardByButton, 'cell'> | null): boolean =>
  lastHung?.tableKey !== tableKey || (byButton !== null && lastHung.cellOfButton !== null && byButton.cell !== lastHung.cellOfButton);
export const hungCardUnderFilterButton = ({ tableKey, c, hangsFrom }: FilterButtonToHangFrom): HungUnderFilterButton => ({
  x: hangsFrom.x,
  y: hangsFrom.y + hangsFrom.height,
  whose: `${tableKey} ${c}`,
  byButton: {
    underRowOfHeight: hangsFrom.height,
    cell: `${tableKey} ${c}`,
  },
});
export const TABLE_CARD_MARGIN = 5;
export const TABLE_CARD_MIN_ROOM = 240;
export const isClearOfFoot = (top: number, windowHeight: number): boolean => top <= windowHeight - TABLE_CARD_MARGIN;
export const newHungCardState = (hungAt: HungAt | null): HungCardState => ({
  hungAt,
  ofFirst: null,
  place: null,
  isFirst: true,
  isDrawnSince: true,
  hasStepped: false,
  fittedTo: 0,
});
export const rowFollowingCardY = ({ hungAt, place }: Pick<HungCardState, 'hungAt' | 'place'>, windowHeight: number): number | null =>
  hungAt !== null &&
  hungAt.underRowOfHeight !== null &&
  place?.where === 'level' &&
  isClearOfFoot(hungAt.y - hungAt.underRowOfHeight - TABLE_CARD_GAP, windowHeight)
    ? hungAt.y
    : null;
export const hasHungPlaceMoved = (state: HungCardState, y: number): boolean => state.hungAt !== null && state.hungAt.y !== y;
export const markHungCardDrawn = (state: HungCardState, isFirst: boolean): HungCardState =>
  isFirst
    ? {
        ...state,
        ofFirst: state.hasStepped ? state.ofFirst : null,
        isFirst,
        isDrawnSince: true,
      }
    : {
        ...state,
        isFirst,
        isDrawnSince: true,
        hasStepped: true,
      };
export const cardTopLimit = (top: number, bottomInset: number, barsInset: number): number | undefined =>
  bottomInset > barsInset ? undefined : top;
export const foundTableOutlines = (
  view: PageState,
  reads: ReadsWithTextMeasurer,
  foundTables: readonly Pick<OutlinableTable, 'key' | 'area' | 'comesLater'>[],
): FoundTableOutline[] =>
  tableOutlinesOf(
    foundTables.map(
      ({ key, area, comesLater }) => ({
        key,
        where: area,
        more: {
          comesLater,
        },
      }),
    ),
    view,
    reads,
  );
