import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { PageState } from './initial-state.ts';
import type { LinkCardAsked } from './event-reducer.ts';
import { readCellLink } from '../links/cell-links.ts';
import { cellWithFormulaShown } from '../grid/formulas-shown.ts';
import {
  mergedAreaOrCellOf,
  activeAnchorCell,
  selectedArea,
  isSameArea,
  anchorCellOf,
  isSameCell,
  scrollToShowSelection,
} from '../selection/model.ts';
import { rangeSpansOnScreen, hitTestGrid, isRangeInSight } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { shownCellText } from '../format/shown-text.ts';
import { stepBackIntoCells } from './escape.ts';
import { isIdleOrTapping } from './transitions.ts';
import { linkAddressesOfCell } from '../links/text-links.ts';
import { errorCodeOfCell } from '../formulas/error-tells.ts';
import { isModalOpen } from '../ui/find.ts';
import { cardBeingShown } from './list-cards.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function cellLinkShown({ areFormulasShown }: Pick<PageState, 'areFormulasShown'>, reads: WorkbookReads, cellId: CellId) {
  let [cell, format] = [reads.cellOf(cellId), reads.formatOf(cellId)];
  return readCellLink(areFormulasShown ? cellWithFormulaShown(cell, format) : cell, format);
}
export function linkPlacementKey(state: PageState, reads: ReadsWithTextMeasurer, cellId: CellId): string {
  let area = mergedAreaOrCellOf(reads, cellId);
  if (area === null) return '';
  let { across, down } = rangeSpansOnScreen(area, state, layoutOfView(state, reads), state);
  let { text } = shownCellText(reads.cellOf(cellId), 1 / 0, reads.decimalSign);
  return JSON.stringify([across, down, text, reads.formatOf(cellId)]);
}
export function cellExplained(state: PageState, reads: WorkbookReads): CellExplained | null {
  if (isExplainingBlocked(state)) return null;
  let {
    pointedAt,
    isHiddenForSelection,
    isSelectionByMouse,
    markedLink,
  } = state.explainedUnderCell;
  if (pointedAt !== null && hasCellSomethingToExplain(state, reads, pointedAt.cellId))
    return {
      cellId: pointedAt.cellId,
      by: 'pointer',
      link: pointedAt.link,
      isByPress: pointedAt.isByPress,
    };
  let anchorCell: CellId = activeAnchorCell(state, reads);
  let [areaSelected, areaOfAnchor] = [selectedArea(state, reads), mergedAreaOrCellOf(reads, anchorCell)];
  if (!(areaSelected !== null && areaOfAnchor !== null && isSameArea(areaSelected, areaOfAnchor)) || isHiddenForSelection) return null;
  let isSomethingToExplain = isSelectionByMouse
    ? linkAddressesAt(state, reads, anchorCell).length > 0
    : hasCellSomethingToExplain(state, reads, anchorCell);
  let isLinkCardUnasked = markedLink === null && hasLinksInTextOnly(state, reads, anchorCell);
  return isSomethingToExplain && !isLinkCardUnasked
    ? {
        cellId: anchorCell,
        by: 'selection',
        link: null,
        isByPress: false,
      }
    : null;
}
export function cellUnderPoint(state: PageState, reads: ReadsWithTextMeasurer, point: PagePoint): CellId | null {
  let hit = hitTestGrid(point, state, layoutOfView(state, reads));
  let cellId = hit?.kind === 'cell' ? reads.cellIdAt(state.sheetId, hit.rowIndex, hit.columnIndex) : null;
  return cellId === null ? null : anchorCellOf(reads, cellId);
}
export function explainCellUnderPointer(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  point: PagePoint | null,
  hit: LinkPointedAt | null,
  isByPress: boolean = false,
): PageState {
  let cellUnderPointer = point === null ? null : cellUnderPoint(state, reads, point);
  let cellId = hit === null ? cellUnderPointer : reads.cellIdAt(state.sheetId, hit.inCell.rowIndex, hit.inCell.columnIndex);
  let { hiddenUnderPointer } = state.explainedUnderCell;
  let isHiddenUnderPointer = cellId !== null && hiddenUnderPointer !== null && isSameCell(hiddenUnderPointer, cellId);
  let link =
    cellId !== null &&
    hit !== null &&
    hit.scroll.scrollLeft === state.scrollLeft &&
    hit.scroll.scrollTop === state.scrollTop &&
    linkAddressesAt(state, reads, cellId).includes(hit.address)
      ? hit
      : null;
  let isExplained =
    cellId !== null &&
    !isHiddenUnderPointer &&
    hasCellSomethingToExplain(state, reads, cellId) &&
    (hit === null ? !hasLinksInTextOnly(state, reads, cellId) : link !== null);
  let anchorCell: CellId = activeAnchorCell(state, reads);
  let isSelectionCardHidden = isExplained && !isSameCell(cellId!, anchorCell) && linkAddressesAt(state, reads, anchorCell).length > 0;
  return {
    ...(isExplained ? stepBackIntoCells(state) : state),
    explainedUnderCell: {
      ...state.explainedUnderCell,
      isHiddenForSelection: state.explainedUnderCell.isHiddenForSelection || isSelectionCardHidden,
      pointedAt:
        point !== null && isExplained
          ? {
              cellId: cellId!,
              point,
              link,
              wordsPlacedBy: link === null ? '' : linkPlacementKey(state, reads, cellId!),
              isByPress,
            }
          : null,
      hiddenUnderPointer: isHiddenUnderPointer ? hiddenUnderPointer : null,
      markedLink: isSelectionCardHidden ? null : state.explainedUnderCell.markedLink,
      areKeysNewOnCard: !isSelectionCardHidden && state.explainedUnderCell.areKeysNewOnCard,
    },
  };
}
export function isCellInSight(state: PageState, reads: ReadsWithTextMeasurer, cellId: CellId): boolean {
  let area = mergedAreaOrCellOf(reads, cellId);
  return area !== null && isRangeInSight(area, state, layoutOfView(state, reads), state);
}
export function putAwayErrorCard(state: PageState, reads: WorkbookReads, key: string): PageState {
  let {
    pointedAt,
    isHiddenForSelection,
    hiddenUnderPointer,
  } = state.explainedUnderCell;
  let isSameKey = (cellId: CellId | null) => cellId !== null && cellKeyText(cellId) === key;
  return {
    ...state,
    explainedUnderCell: {
      ...state.explainedUnderCell,
      pointedAt: isSameKey(pointedAt?.cellId ?? null) ? null : pointedAt,
      isHiddenForSelection: isHiddenForSelection || isSameKey(activeAnchorCell(state, reads)),
      hiddenUnderPointer: isSameKey(hiddenUnderPointer) ? null : hiddenUnderPointer,
    },
  };
}
export function leaveLinkCard(state: PageState, reads: WorkbookReads, key: string | null, isLeaving: boolean): PageState {
  let {
    pointedAt,
    isHiddenForSelection,
    hiddenUnderPointer,
    markedLink,
  } = state.explainedUnderCell;
  let hasLinks = (cellId: CellId | null) => cellId !== null && linkAddressesAt(state, reads, cellId).length > 0;
  let isCardLeft = (markedLink === null || isLeaving) && cellKeyText(activeAnchorCell(state, reads)) === key;
  return {
    ...state,
    explainedUnderCell: {
      ...state.explainedUnderCell,
      pointedAt: hasLinks(pointedAt?.cellId ?? null) ? null : pointedAt,
      isHiddenForSelection: isHiddenForSelection || isCardLeft,
      hiddenUnderPointer: hasLinks(hiddenUnderPointer) ? null : hiddenUnderPointer,
      markedLink: isCardLeft ? null : markedLink,
      areKeysNewOnCard: !isCardLeft && state.explainedUnderCell.areKeysNewOnCard,
    },
  };
}
export function askLinkCard(state: PageState, reads: ReadsWithTextMeasurer, point: PagePoint | null, link: LinkPointedAt | null): PageState {
  let stateAsked: PageState =
    link === null
      ? state
      : {
          ...state,
          dragging: null,
        };
  if (!canExplainUnderCell(stateAsked)) return state;
  let { explainedUnderCell } = state;
  if (point !== null)
    return explainCellUnderPointer(
      {
        ...stateAsked,
        explainedUnderCell: {
          ...explainedUnderCell,
          hiddenUnderPointer: null,
        },
      },
      reads,
      point,
      link,
      link !== null,
    );
  let { pointedAt, hiddenUnderPointer } = explainedUnderCell;
  let anchorCell: CellId = activeAnchorCell(state, reads);
  let url = cellLinkShown(state, reads, anchorCell)?.url;
  let hasLinksInText = hasLinksInTextOnly(state, reads, anchorCell);
  let isAnchorPointedAt = pointedAt !== null && pointedAt.link === null && isSameCell(pointedAt.cellId, anchorCell);
  return scrollToShowSelection(
    {
      ...stepBackIntoCells(state),
      ...(url !== undefined && {
        lastDone: {
          what: 'linkAddressShown',
          url,
        },
      }),
      explainedUnderCell: {
        ...explainedUnderCell,
        pointedAt: isAnchorPointedAt ? pointedAt : null,
        isHiddenForSelection: false,
        hiddenUnderPointer: isAnchorPointedAt ? hiddenUnderPointer : (pointedAt?.cellId ?? hiddenUnderPointer),
        markedLink: hasLinksInText ? 0 : null,
        areKeysNewOnCard: hasLinksInText,
      },
    },
    reads,
  );
}
export function hideExplainedCard(state: PageState, reads: WorkbookReads): PageState {
  let {
    pointedAt,
    isHiddenForSelection,
    hiddenUnderPointer,
  } = state.explainedUnderCell;
  return {
    ...state,
    explainedUnderCell: {
      ...state.explainedUnderCell,
      pointedAt: null,
      isHiddenForSelection: isHiddenForSelection || hasCellSomethingToExplain(state, reads, activeAnchorCell(state, reads)),
      hiddenUnderPointer: pointedAt?.cellId ?? hiddenUnderPointer,
      markedLink: null,
      areKeysNewOnCard: false,
    },
  };
}
export function moveMarkedLink(state: PageState, reads: WorkbookReads, key: string, isComposing: boolean): PageState | null {
  let { markedLink } = state.explainedUnderCell;
  if (markedLink === null) return null;
  if (LINK_KEEPING_MODIFIER_KEYS.has(key)) return state;
  if (isComposing) return null;
  if (key === 'Escape') return hideExplainedCard(state, reads);
  let step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  if (step === 0) return null;
  let linkCount = linkAddressesAt(state, reads, activeAnchorCell(state, reads)).length;
  if (linkCount < 2) return null;
  return {
    ...state,
    explainedUnderCell: {
      ...state.explainedUnderCell,
      markedLink: (markedLink + step + linkCount) % linkCount,
      areKeysNewOnCard: false,
    },
  };
}
export function updateExplainedUnderCell(
  stateBefore: PageState,
  state: PageState,
  reads: ReadsWithTextMeasurer,
  pointerKind: 'mouse' | 'fingerOrPen' | null,
): PageState {
  let {
    pointedAt,
    isHiddenForSelection,
    hiddenUnderPointer,
    markedLink,
  } = state.explainedUnderCell;
  let cellPointedAt = pointedAt === null ? null : pointedAt.link === null ? cellUnderPoint(state, reads, pointedAt.point) : pointedAt.cellId;
  let isSelectionMoved =
    state.sheetId !== stateBefore.sheetId ||
    !isSameCell(state.activeCell, stateBefore.activeCell) ||
    !isSameCell(state.selectionCorner, stateBefore.selectionCorner);
  let isStillPointedAt = pointedAt !== null && cellPointedAt !== null && isSameCell(cellPointedAt, pointedAt.cellId);
  let isLinkMoved =
    pointedAt !== null &&
    pointedAt.link !== null &&
    (state.zoom !== stateBefore.zoom ||
      state.gridWidth !== stateBefore.gridWidth ||
      linkPlacementKey(state, reads, pointedAt.cellId) !== pointedAt.wordsPlacedBy);
  let isPointedAtGone = pointedAt !== null && (!isIdleOrTapping(state) || !isStillPointedAt || isSelectionMoved || isLinkMoved);
  let anchorCell: CellId = activeAnchorCell(state, reads);
  let isHidingOver = isSelectionMoved || (state.dragging !== null && stateBefore.dragging === null);
  let isDragged = state.dragging !== null || stateBefore.dragging !== null;
  let isSelectionByMouse =
    pointerKind !== null && (isSelectionMoved || state.dragging?.kind === 'selecting')
      ? pointerKind === 'mouse'
      : state.explainedUnderCell.isSelectionByMouse && (!isSelectionMoved || isDragged);
  let isMarkedLinkGone =
    markedLink !== null &&
    (state.sheetId !== stateBefore.sheetId ||
      !isSameCell(state.activeCell, stateBefore.activeCell) ||
      cellExplained(state, reads)?.by !== 'selection' ||
      !isCellInSight(state, reads, anchorCell) ||
      markedLink >= linkAddressesAt(state, reads, anchorCell).length ||
      cellLinkShown(state, reads, anchorCell) !== null);
  if (
    !isPointedAtGone &&
    isSelectionByMouse === state.explainedUnderCell.isSelectionByMouse &&
    !(pointerKind === 'mouse' && hiddenUnderPointer !== null) &&
    !(isHiddenForSelection && isHidingOver) &&
    !isMarkedLinkGone
  )
    return state;
  return {
    ...state,
    explainedUnderCell: {
      pointedAt: isPointedAtGone ? null : pointedAt,
      isHiddenForSelection: isHiddenForSelection && !isHidingOver,
      isSelectionByMouse,
      hiddenUnderPointer:
        pointerKind === 'mouse' ? null : pointedAt !== null && isStillPointedAt && isSelectionMoved ? pointedAt.cellId : hiddenUnderPointer,
      markedLink: isMarkedLinkGone ? null : markedLink,
      areKeysNewOnCard: !isMarkedLinkGone && state.explainedUnderCell.areKeysNewOnCard,
    },
  };
}
export const NOTHING_EXPLAINED_UNDER_CELL: ExplainedUnderCell = {
  pointedAt: null,
  isHiddenForSelection: false,
  isSelectionByMouse: false,
  hiddenUnderPointer: null,
  markedLink: null,
  areKeysNewOnCard: false,
};
export const linkAddressesAt = (state: Pick<PageState, 'areFormulasShown'>, reads: WorkbookReads, cellId: CellId) =>
  linkAddressesOfCell(reads, cellId, cellLinkShown(state, reads, cellId)?.url ?? null);
export const hasLinksInTextOnly = (state: Pick<PageState, 'areFormulasShown'>, reads: WorkbookReads, cellId: CellId): boolean =>
  cellLinkShown(state, reads, cellId) === null && linkAddressesAt(state, reads, cellId).length > 0;
export const hasCellSomethingToExplain = (state: Pick<PageState, 'areFormulasShown'>, reads: WorkbookReads, cellId: CellId): boolean =>
  errorCodeOfCell(reads.cellOnShowIn(cellId)) !== null || linkAddressesAt(state, reads, cellId).length > 0;
export const isExplainingBlocked = (state: PageState): boolean =>
  state.mode.kind === 'editing' ||
  state.menu !== null ||
  state.contextBarMenu !== null ||
  state.ownFilterList !== null ||
  !isIdleOrTapping(state) ||
  state.calendar !== null ||
  state.linkForm !== null ||
  state.doesCommentModePickCells ||
  state.isSteppedOutOfCells ||
  state.fixesOnCells.stage !== null ||
  isModalOpen(state) ||
  cardBeingShown(state) !== null;
export const canExplainUnderCell = (state: PageState): boolean =>
  !isExplainingBlocked({
    ...state,
    isSteppedOutOfCells: false,
    menu: null,
  });
export const withoutLinkPointedAt = (state: PageState): PageState =>
  (state.explainedUnderCell.pointedAt?.link ?? null) === null
    ? state
    : {
        ...state,
        explainedUnderCell: {
          ...state.explainedUnderCell,
          pointedAt: null,
        },
      };
export const cellKeyText = ({ rowId, columnId }: Pick<CellId, 'rowId' | 'columnId'>): string => `${rowId}/${columnId}`;
export const LINK_KEEPING_MODIFIER_KEYS = new Set<string>(['Alt', 'Control', 'Meta', 'Shift']);
export const withoutMarkedLink = (state: PageState): PageState =>
  state.explainedUnderCell.markedLink === null
    ? state
    : {
        ...state,
        explainedUnderCell: {
          ...state.explainedUnderCell,
          markedLink: null,
          areKeysNewOnCard: false,
        },
      };
export const keepIfSameJson = <T,>(next: T, before: T): T =>
  JSON.stringify(next) === JSON.stringify(before) ? before : next;
/** A link of a cell's text under the pointer, where it is drawn and how the cells were scrolled then. */
type LinkPointedAt = NonNullable<LinkCardAsked['link']>;
/** The cell the pointer rests on, and the link of its text it rests on, if any. */
export interface PointedAt {
  cellId: CellId;
  point: PagePoint;
  link: LinkPointedAt | null;
  /** Where the link was drawn when pointed at: once it is drawn elsewhere, the card goes. */
  wordsPlacedBy: string;
  isByPress: boolean;
}
/** The cell whose card is shown under it, and whether the pointer or the selection asked for it. */
export interface CellExplained {
  cellId: CellId;
  by: 'pointer' | 'selection';
  link: LinkPointedAt | null;
  isByPress: boolean;
}
/** What the page last did when it showed the address a link goes to. */
export interface LinkAddressShown {
  what: 'linkAddressShown';
  url: string;
}
export interface ExplainedUnderCell {
  pointedAt: PointedAt | null;
  isHiddenForSelection: boolean;
  isSelectionByMouse: boolean;
  hiddenUnderPointer: CellId | null;
  markedLink: number | null;
  areKeysNewOnCard: boolean;
}
