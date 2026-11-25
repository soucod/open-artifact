import { ownRowOrderOfSheet, wholeRowSpanIn, type RowOrderSide } from '../model/line-ids.ts';
import { selectedArea, isSameCell } from '../selection/model.ts';
import { peerColorOf } from './colors.ts';
import { inkOnPeerColor } from '@open-artifact/editor-kit';
import type { SheetId } from '@open-artifact/sheets-core';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { ProfileOfPerson } from '../chips/people-list.ts';
import type { CellArea, CellSelection, SelectionToRead } from '../selection/model.ts';
import type { HeardSelection, RoomPresence } from './room.ts';
/** A selection by its two corners, with nothing about how it was walked. */
export type SelectionCorners = Pick<CellSelection, 'activeCell' | 'selectionCorner'>;
/** How another person's name flag looks. */
export interface PeerFlagLook {
  name: string;
  color: string;
  inkColor: string;
}
/** Another person on a sheet, as shown over its tab. */
export interface PeerFlag extends PeerFlagLook {
  userId: string;
  avatarUrl: string;
}
interface SelectedAreaCached {
  reads: WorkbookReads;
  area: CellArea | null;
}
interface SelectionAsSeenCached {
  reads: WorkbookReads;
  seen: SelectionCorners;
}
interface PeerFlagsCached {
  profilesById: PageState['profilesById'];
  bySheet: Map<SheetId, PeerFlag[]>;
}
export function withSelectionsOfOthers(state: PageState, heard: readonly HeardSelection[], nowMs: number): PageTransition {
  let isSame =
    heard.length === state.selectionsOfOthers.length &&
    heard.every((heardOne, index) => {
      let known = state.selectionsOfOthers[index];
      return (
        known?.tabKey === heardOne.tabKey &&
        known.userId === heardOne.userId &&
        known.colorClaimed === heardOne.colorClaimed &&
        isSameToldSelection(known.selection, heardOne.selection)
      );
    });
  let userIdsToLookUp = [...new Set(heard.map(({ userId }) => userId))].filter(
    (userId) => (state.profilesById.get(userId)?.name ?? '') === '',
  );
  return {
    state: isSame
      ? state
      : {
          ...state,
          selectionsOfOthers: heard.map((heardOne) => {
            let known = state.selectionsOfOthers.find(
              ({ userId, selection }) =>
                userId === heardOne.userId && isSameToldSelection(selection, heardOne.selection),
            );
            return {
              ...heardOne,
              movedAtMs: known?.movedAtMs ?? nowMs,
            };
          }),
        },
    effects:
      userIdsToLookUp.length === 0
        ? []
        : [
            {
              kind: 'lookUpPeople',
              userIds: userIdsToLookUp,
            },
          ],
  };
}
export function withOwnSelectionTold({ state, effects }: PageTransition, reads: WorkbookReads): PageTransition {
  let { activeCell, selectionCorner, selectionToldToOthers: told } = state;
  let selection = selectionInRowOrder(
    'stored',
    {
      activeCell,
      selectionCorner,
    },
    reads,
  );
  if (told !== null && isSameToldSelection(told, selection))
    return {
      state,
      effects,
    };
  if (told !== null && state.followed !== null)
    return {
      state,
      effects,
    };
  return {
    state: {
      ...state,
      selectionToldToOthers: selection,
    },
    effects: [
      ...effects,
      {
        kind: 'tellOthersOwnSelection',
        selection,
      },
    ],
  };
}
/** The same selection with its rows taken in the other order: as the sheet shows them, or as they are stored. */
export function selectionInRowOrder(order: RowOrderSide, selection: SelectionCorners, reads: WorkbookReads): SelectionCorners {
  let { activeCell, selectionCorner } = selection;
  let ownRowOrder = ownRowOrderOfSheet(reads, activeCell.sheetId);
  if (ownRowOrder === null || activeCell.rowId === selectionCorner.rowId) return selection;
  let fromOrder = order === 'seen' ? ownRowOrder.stored : ownRowOrder.seen;
  let [activeIndex, cornerIndex] = [fromOrder.indexOf(activeCell.rowId), fromOrder.indexOf(selectionCorner.rowId)];
  if (activeIndex === null || cornerIndex === null) return selection;
  let span = wholeRowSpanIn(order, ownRowOrder, {
    firstIndex: Math.min(activeIndex, cornerIndex),
    count: Math.abs(activeIndex - cornerIndex) + 1,
  });
  if (span === null)
    return {
      activeCell,
      selectionCorner: activeCell,
    };
  let [firstRowId, lastRowId] = [ownRowOrder[order].idAt(span.firstIndex), ownRowOrder[order].idAt(span.firstIndex + span.count - 1)];
  if (firstRowId === null || lastRowId === null) return selection;
  return {
    activeCell: {
      ...activeCell,
      rowId: activeIndex < cornerIndex ? firstRowId : lastRowId,
    },
    selectionCorner: {
      ...selectionCorner,
      rowId: activeIndex < cornerIndex ? lastRowId : firstRowId,
    },
  };
}
export function selectedAreaAsSeen(selection: SelectionCorners, reads: WorkbookReads): CellArea | null {
  let cached = selectionAsSeenCache.get(selection);
  let seen = cached?.reads === reads ? cached.seen : selectionInRowOrder('seen', selection, reads);
  selectionAsSeenCache.set(selection, {
    reads,
    seen,
  });
  return cachedSelectedArea(seen, reads);
}
export function cachedSelectedArea(selection: SelectionToRead, reads: WorkbookReads): CellArea | null {
  let cached = selectedAreaCache.get(selection);
  if (cached?.reads === reads) return cached.area;
  let area = selectedArea(selection, reads);
  selectedAreaCache.set(selection, {
    reads,
    area,
  });
  return area;
}
export function peerFlagLook(
  { userId, colorClaimed }: Pick<HeardSelection, 'userId' | 'colorClaimed'>,
  profilesById: PageState['profilesById'],
): PeerFlagLook | null {
  let { name: personName = '', color: usualColor = null }: Partial<ProfileOfPerson> = profilesById.get(userId) ?? {};

  if (personName === '') return null;
  let color = peerColorOf(colorClaimed, usualColor, userId);
  return {
    name: personName,
    color,
    inkColor: inkOnPeerColor(color),
  };
}
export function peerFlagsOnSheet(
  sheetId: SheetId,
  { selectionsOfOthers, profilesById }: Pick<PageState, 'selectionsOfOthers' | 'profilesById'>,
): readonly PeerFlag[] {
  let cached = peerFlagsCache.get(selectionsOfOthers);
  if (cached?.profilesById === profilesById) return cached.bySheet.get(sheetId) ?? NO_PEER_FLAGS;
  let flagsBySheet = new Map<SheetId, PeerFlag[]>();
  for (let heard of selectionsOfOthers) {
    let { userId, selection } = heard;
    let flagsOnSheet = flagsBySheet.get(selection.activeCell.sheetId) ?? [];
    if (flagsOnSheet.some((peerFlag) => peerFlag.userId === userId)) continue;
    let look = peerFlagLook(heard, profilesById);
    if (look === null) continue;
    let avatarUrl = profilesById.get(userId)?.avatarUrl ?? '';
    let shownAvatarUrl = avatarUrl.startsWith('data:') ? '' : avatarUrl;
    flagsBySheet.set(selection.activeCell.sheetId, [
      ...flagsOnSheet,
      {
        ...look,
        userId,
        avatarUrl: shownAvatarUrl,
      },
    ]);
  }
  peerFlagsCache.set(selectionsOfOthers, {
    profilesById,
    bySheet: flagsBySheet,
  });
  return flagsBySheet.get(sheetId) ?? NO_PEER_FLAGS;
}
/** Room presence for a workbook that is not the page's own: tells nothing and hears no one. */
export const inertRoomPresence: RoomPresence = {
  tellOwnSelection() {},
  tellAgentWhatIsSelected() {},
  tellWhomViewFollows() {},
  personWithTab: () => null,
  onSelectionsChanged: () => () => {},
};
export const isSameToldSelection = (selection: SelectionCorners, otherSelection: SelectionCorners): boolean =>
  isSameCell(selection.activeCell, otherSelection.activeCell) && isSameCell(selection.selectionCorner, otherSelection.selectionCorner);
export const selectedAreaCache = new WeakMap<SelectionToRead, SelectedAreaCached>();
export const peerFlagsCache = new WeakMap<PageState['selectionsOfOthers'], PeerFlagsCached>();
export const NO_PEER_FLAGS: readonly PeerFlag[] = [];
export const selectionAsSeenCache = new WeakMap<SelectionCorners, SelectionAsSeenCached>();
