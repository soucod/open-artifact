import type { PageApi, PageRoom, PeerOfRoom, RoomPeersEvent } from '../host/sheets-host.ts';
import { CHROME_PEER_KEY, MAX_CHROME_PEERS, type ChromePeer } from '@open-artifact/runtime';
import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';

import type { SelectedToldToAgent } from '../state/initial-state.ts';
import type { SelectionCorners } from './selections.ts';
import type { PeopleDirectory } from './people.ts';
import { SHEETS_NEVER_GIVEN_COLORS } from './colors.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { createPeerColorKeeper, normalizePeerColor, type PeerColorClaim } from '@open-artifact/editor-kit';
import { reportErrorSoftly } from '../engine/loader.ts';
import { isViewId } from '../agent/view-context.ts';
/** A cell of a selection told in presence, where the sheet is told once for both corners. */
export type CellIdsOnSheet = Pick<CellId, 'rowId' | 'columnId'>;
/** Where a viewer's selection is, as told to the room under `CURSOR_PRESENCE_KEY`. */
export interface CursorInPresence {
  sheetId: SheetId;
  activeCell: CellIdsOnSheet;
  selectionCorner: CellIdsOnSheet;
  at: number;
}
/** Another viewer's selection, heard from the room. */
export interface HeardSelection {
  tabKey: string;
  userId: string;
  colorClaimed: string | null;
  selection: SelectionCorners;
}
/** A heard selection and when that viewer's tab was last at the page. */
export interface PeerCursor {
  heard: HeardSelection;
  at: number;
}
/** What the page tells the room about itself, and hears from it about the other viewers. */
export interface RoomPresence {
  tellOwnSelection(selection: SelectionCorners | null): void;
  tellAgentWhatIsSelected(selected: SelectedToldToAgent): void;
  tellWhomViewFollows(tabKey: string | null): void;
  personWithTab(tabKey: string): string | null;
  onSelectionsChanged(onChange: (selections: HeardSelection[]) => void): () => void;
}
export function readOwnColor(storage: () => Storage): string | null {
  try {
    let color = storage().getItem(OWN_COLOR_STORAGE_KEY);
    return color === null || SHEETS_NEVER_GIVEN_COLORS.includes(color.toLowerCase()) ? null : color;
  } catch {
    return null;
  }
}
export function claimedColorOfPresence(presence: Readonly<Record<string, unknown>>): string | null {
  let who = presence[PRESENCE_WHO_KEY];
  return isNonNullObject(who) && typeof who.c === 'string' ? who.c : null;
}
export function peerOfRoom(peer: unknown): RoomPeer[] {
  if (!isNonNullObject(peer)) return [];
  let { peer: peerId, by, isMe, sameTab, kind, presence } = peer;
  if (typeof peerId !== 'string' || typeof by !== 'string' || kind !== 'viewer') return [];
  return [
    {
      peer: peerId,
      by,
      isMe: isMe === true,
      sameTab: sameTab === true,
      presence: isNonNullObject(presence) ? presence : {},
    },
  ];
}
export interface RoomPeer {
  peer: string;
  by: string;
  isMe: boolean;
  sameTab: boolean;
  agent?: boolean;
  presence: Record<string, unknown>;
}

interface ColorRoom {
  peers?: () => unknown;
  onConnection?: (onChange: (connected: boolean) => void, onClose: () => void) => void;
}

export interface PeerColorKeeping {
  roomChanged(): void;
  dispose(): void;
}

function colorClaimOf(peer: RoomPeer): PeerColorClaim | undefined {
  const who = peer.presence[PRESENCE_WHO_KEY];
  if (!isNonNullObject(who)) return undefined;
  const color = normalizePeerColor(who.c);
  const at = who.t;

  return color !== undefined && typeof at === 'number' && Number.isFinite(at)
    ? { key: peer.by, peer: peer.peer, own: peer.isMe, c: color, t: at }
    : undefined;
}

export function startPeerColorKeeper(
  room: ColorRoom,
  me: { userId: string; usualColor: string },
  publish: (claim: Record<string, unknown>) => void,
  storage: () => Storage,
): PeerColorKeeping | null {
  const { peers, onConnection } = room;
  if (typeof peers !== 'function') return null;
  const roomPeers = (): RoomPeer[] => {
    const listed = peers.call(room);
    return Array.isArray(listed) ? listed.flatMap(peerOfRoom) : [];
  };
  let published: Record<string, unknown> = {};
  const keeper = createPeerColorKeeper({
    id: me.userId,
    peer: roomPeers().find((peer) => peer.sameTab)?.peer ?? '',
    neverGiven: SHEETS_NEVER_GIVEN_COLORS,
    publish(claim) {
      const entries = Object.entries({ ...published, ...claim });
      published = Object.fromEntries(entries.filter(([, value]) => value !== null));
      publish(published);
    },
    claims: () =>
      roomPeers().flatMap((peer) => (peer.sameTab || peer.agent === true ? [] : (colorClaimOf(peer) ?? []))),
    kept: {
      read: () => readOwnColor(storage) ?? (normalizePeerColor(me.usualColor) ?? null),
      write(color) {
        try {
          storage().setItem(OWN_COLOR_STORAGE_KEY, color);
        } catch {}
      },
    },
    now: Date.now,
    after(run, ms) {
      const timer = setTimeout(guardCallback(run), ms);
      return () => clearTimeout(timer);
    },
    every(run, ms) {
      const timer = setInterval(guardCallback(run), ms);
      return () => clearInterval(timer);
    },
  });
  let isDisposed = false;
  const dispose = (): void => {
    isDisposed = true;
    keeper.dispose();
  };
  try {
    if (typeof onConnection !== 'function') keeper.here();
    else
      onConnection.call(
        room,
        guardCallback((connected: boolean) => (connected ? keeper.here() : keeper.away())),
        guardCallback(dispose),
      );
  } catch (error) {
    dispose();
    throw error;
  }
  return { roomChanged: () => void (isDisposed || keeper.heard()), dispose };
}
export function readCellIds(cell: unknown): CellIdsOnSheet | null {
  if (!isNonNullObject(cell)) return null;
  let { rowId, columnId } = cell;
  return typeof rowId === 'string' && typeof columnId === 'string'
    ? {
        rowId,
        columnId,
      }
    : null;
}
export function readPresenceSelection(selection: unknown): SelectionCorners | null {
  if (!isNonNullObject(selection) || typeof selection.sheetId !== 'string') return null;
  let { sheetId } = selection;
  let [activeCell, selectionCorner] = [readCellIds(selection.activeCell), readCellIds(selection.selectionCorner)];
  if (activeCell === null || selectionCorner === null) return null;
  return {
    activeCell: {
      sheetId,
      ...activeCell,
    },
    selectionCorner: {
      sheetId,
      ...selectionCorner,
    },
  };
}
export function readPeerCursor(peer: unknown): PeerCursor | null {
  if (!isNonNullObject(peer)) return null;
  let { peer: tabKey, by: userId, isMe, kind, presence } = peer;
  if (typeof tabKey !== 'string' || typeof userId !== 'string') return null;
  if (isMe !== false || kind !== 'viewer' || !isNonNullObject(presence)) return null;
  let cursor = presence[CURSOR_PRESENCE_KEY];
  let selection = readPresenceSelection(cursor);
  if (selection === null) return null;
  let at = isNonNullObject(cursor) && Number.isFinite(cursor.at) ? Number(cursor.at) : 0;
  return {
    heard: {
      tabKey,
      userId,
      colorClaimed: claimedColorOfPresence(presence),
      selection,
    },
    at,
  };
}
export function latestPeerCursor(cursors: readonly PeerCursor[]): HeardSelection {
  let isLater = (one: PeerCursor, other: PeerCursor) =>
    one.at === other.at ? one.heard.tabKey > other.heard.tabKey : one.at > other.at;
  return cursors.reduce((latest, next) => (isLater(next, latest) ? next : latest)).heard;
}
export function selectionsOfOthersFrom(peers: readonly unknown[]): HeardSelection[] {
  let cursorsByUser = new Map<string, PeerCursor[]>();
  for (let cursor of peers.map(readPeerCursor))
    if (cursor !== null) cursorsByUser.set(cursor.heard.userId, [...(cursorsByUser.get(cursor.heard.userId) ?? []), cursor]);
  return [...cursorsByUser.values()].map(latestPeerCursor);
}
export function peerTabEntries(peer: unknown): Array<[tabKey: string, userId: string]> {
  if (!isNonNullObject(peer)) return [];
  let { peer: tabKey, by: userId, isMe, kind } = peer;
  return isMe === false && kind === 'viewer' && typeof tabKey === 'string' && typeof userId === 'string' ? [[tabKey, userId]] : [];
}
export function createRoomPresence(
  hostWindow: Window,
  page: PageApi,
  people: PeopleDirectory,
  storage: () => Storage = () => sessionStorage,
  now: () => number = Date.now,
): RoomPresence {
  let roomLoading: Promise<PageRoom | null> | null = null;
  let loadRoom = () => (
    (roomLoading ??= (async (): Promise<PageRoom | null> => {
      try {
        let room = await page.use('room');
        return isNonNullObject(room) && room.available !== false ? room : null;
      } catch (error) {
        reportErrorSoftly(error, 'otherViewers');
        return null;
      }
    })()),
    roomLoading
  );
  let pending: Record<string, unknown> = {};
  let publishPresence = async (fields: Record<string, unknown>): Promise<void> => {
    pending = {
      ...pending,
      ...fields,
    };
    let room = await loadRoom();
    let setPresence = room?.presence;
    if (Object.keys(pending).length === 0 || typeof setPresence !== 'function') return;
    let toSend = pending;
    pending = {};
    try {
      await setPresence.call(room, toSend);
    } catch (error) {
      if (isNonNullObject(error) && error.code === 'invalid_argument') reportErrorSoftly(error, 'otherViewers');
    }
  };
  let ownSelection: SelectionCorners | null = null;
  let timeAtPage: number | null = null;
  let markTimeAtPage = () => {
    timeAtPage = now();
    try {
      storage().setItem(TIME_AT_PAGE_STORAGE_KEY, String(timeAtPage));
    } catch {}
  };
  let readTimeAtPage = () => {
    try {
      let storedTime = storage().getItem(TIME_AT_PAGE_STORAGE_KEY);
      return storedTime === null || !Number.isFinite(Number(storedTime)) ? null : Number(storedTime);
    } catch {
      return null;
    }
  };
  let currentTimeAtPage = () => {
    let storedTime = timeAtPage === null ? readTimeAtPage() : null;
    if (storedTime !== null) timeAtPage = storedTime + 1;
    if (hostWindow.document.hasFocus() || (timeAtPage === null && !hostWindow.document.hidden)) markTimeAtPage();
    timeAtPage ??= 0;
    return timeAtPage;
  };
  let publishCursor = () =>
    void publishPresence({
      [CURSOR_PRESENCE_KEY]: ownSelection === null ? null : cursorPresence(ownSelection, currentTimeAtPage()),
    });
  let isBlurred = true;
  let onFocus = () => {
    if (!isBlurred || !hostWindow.document.hasFocus()) return;
    isBlurred = false;
    markTimeAtPage();
    if (ownSelection !== null) publishCursor();
  };
  hostWindow.addEventListener('blur', () => void (isBlurred = true));
  hostWindow.addEventListener('focus', onFocus, true);
  let userByTab = new Map<string, string>();
  let startColorKeeper = async (room: PageRoom): Promise<PeerColorKeeping | null | undefined> => {
    try {
      let viewer = await people.viewer();
      let [profile] = viewer === null ? [] : await people.profiles([viewer.userId]);
      return startPeerColorKeeper(
        room,
        {
          userId: viewer?.userId ?? '',
          usualColor: profile?.color ?? '',
        },
        (colorClaim) =>
          void publishPresence({
            [PRESENCE_WHO_KEY]: colorClaim,
          }),
        storage,
      );
    } catch (error) {
      reportErrorSoftly(error, 'otherViewers');
    }
  };
  return {
    tellOwnSelection(selection) {
      ownSelection = selection;
      publishCursor();
    },
    tellAgentWhatIsSelected: (selected) => void publishPresence(contextPresence(selected)),
    tellWhomViewFollows: (followed) =>
      void publishPresence({
        [FOLLOW_PRESENCE_KEY]:
          followed === null
            ? null
            : {
                of: followed,
              },
      }),
    personWithTab: (tabKey) => userByTab.get(tabKey) ?? null,
    onSelectionsChanged(onChange) {
      let colorKeeper: PeerColorKeeping | null | undefined = null;
      let isStopped = false;
      let stopListening: (() => void) | null = null;
      let heardPeers = (peers: readonly unknown[]) => {
        try {
          userByTab = new Map(peers.flatMap(peerTabEntries));
          onChange(selectionsOfOthersFrom(peers));
          colorKeeper?.roomChanged();
        } catch (error) {
          reportErrorSoftly(error, 'otherViewers');
        }
      };
      (async (): Promise<void> => {
        let room = await loadRoom();
        let onPeers = room?.onPeers;
        if (isStopped || room === null || typeof onPeers !== 'function') return;
        let stopPeers = onPeers.call(
          room,
          (event) => heardPeers(isNonNullObject(event) && Array.isArray(event.peers) ? event.peers : []),
          () => heardPeers([]),
        );
        if (typeof stopPeers === 'function') stopListening = () => void Reflect.apply(stopPeers, undefined, []);
        colorKeeper = await startColorKeeper(room);
        if (isStopped) colorKeeper?.dispose();
      })();
      return () => {
        isStopped = true;
        stopListening?.();
        colorKeeper?.dispose();
        colorKeeper = null;
      };
    },
  };
}
export const PRESENCE_WHO_KEY = 'who';
export const OWN_COLOR_STORAGE_KEY = 'sheets-own-color';
/** Wraps a function the room or a timer calls, so that what it throws is reported and goes no further. */
export const guardCallback =
  <Args extends unknown[]>(run: (...args: Args) => void) =>
  (...args: Args): void => {
    try {
      run(...args);
    } catch (error) {
      reportErrorSoftly(error, 'ownColor');
    }
  };
export const cursorPresence = ({ activeCell, selectionCorner }: SelectionCorners, at: number): CursorInPresence => ({
  sheetId: activeCell.sheetId,
  activeCell: {
    rowId: activeCell.rowId,
    columnId: activeCell.columnId,
  },
  selectionCorner: {
    rowId: selectionCorner.rowId,
    columnId: selectionCorner.columnId,
  },
  at,
});
export const CURSOR_PRESENCE_KEY = 'cursor';
export const FOLLOW_PRESENCE_KEY = 'follow';
export const CONTEXT_PRESENCE_KEY = 'context';
export const contextPresence = ({ byAddress, chartId, ownSort }: SelectedToldToAgent) => ({

  [CONTEXT_PRESENCE_KEY]: {
    sheetNumber: byAddress?.sheetNumber ?? null,
    range: byAddress?.range ?? null,
    activeCell: byAddress?.activeCell ?? null,
    revision: byAddress?.revision ?? null,
    chartId: chartId !== null && isViewId(chartId) ? chartId : null,
    ownSortSheetNumber: ownSort?.sheetNumber ?? null,
    ownSortBy: ownSort?.by ?? null,
  },
});
export const TIME_AT_PAGE_STORAGE_KEY = 'sheets-time-at-page';
/**
 * The others viewing the sheet, for the Shell's list beside History and Share (with Follow, which calls the page's
 * follow handler with their tab key): each viewer's tab but this one, named as the room names them, in the colour
 * they claimed, marked when it is another tab of this viewer or when it follows this tab.
 */
export function chromePeersOf(peers: readonly PeerOfRoom[]): ChromePeer[] {
  let me = peers.find((peer) => peer.isMe);
  let list: ChromePeer[] = peers.flatMap((peer) => {
    if (peer.isMe || peer.kind !== 'viewer' || !CHROME_PEER_KEY.test(peer.peer)) return [];
    let color = normalizePeerColor(claimedColorOfPresence(peer.presence));
    let follow = peer.presence[FOLLOW_PRESENCE_KEY];
    let followsYou = me !== undefined && isNonNullObject(follow) && follow.of === me.peer;
    return [
      {
        key: peer.peer,
        name: peer.name.trim() || peer.by,
        ...(color !== undefined && { color }),
        ...(me !== undefined && peer.by === me.by && { self: true }),
        ...(followsYou && { followsYou: true }),
      },
    ];
  });
  return list.slice(0, MAX_CHROME_PEERS);
}
/** Hears who else views the sheet until stopped; `null` while the room is not there. */
export function watchPeersHere(page: PageApi, heard: (peers: ChromePeer[] | null) => void): () => void {
  let stopped = false;
  let stop: (() => void) | null = null;
  void page.use('room').then(
    (room) => {
      if (stopped || !isNonNullObject(room) || typeof room.onPeers !== 'function') return;
      stop = room.onPeers(
        (event: RoomPeersEvent) => {
          try {
            heard(chromePeersOf(Array.isArray(event?.peers) ? event.peers : []));
          } catch (error) {
            reportErrorSoftly(error, 'otherViewers');
          }
        },
        () => heard(null),
      );
    },
    () => {},
  );
  return () => {
    stopped = true;
    stop?.();
    heard(null);
  };
}
