import * as React from 'react';
/** The room kept at the foot of the page for a side pane that went away: whether it is kept, and what led to it. */
export interface GonePaneRoom {
  wasPaneDrawn: boolean;
  wasPersonAtPane: boolean;
  isKept: boolean;
}
/** What the page is like now, for the room kept for a gone pane. */
export interface PaneRoomNow {
  isPaneDrawn: boolean;
  isChatOverBar: boolean;
  hasPageKeyboard: boolean;
}
export interface RoomForGonePaneAsked {
  isPaneDrawn: boolean;
  isChatOverBar: boolean;
  isMenuOpen: boolean;
  bar: HTMLElement | null;
}
export function onPointerAwayWhileFocused(element: Element, onAway: () => void): () => void {
  let ownerDocument = element.ownerDocument;
  let notifyIfAway = (isPointerOver: boolean) => {
    if (ownerDocument.hasFocus() && !isPointerOver) onAway();
  };
  let handleWindowFocus = () => notifyIfAway(element.matches(':hover'));
  let handlePointerOver = ({ target }: PointerEvent) => notifyIfAway(element.contains(target as Node | null));
  ownerDocument.defaultView?.addEventListener('focus', handleWindowFocus);
  ownerDocument.addEventListener('pointerover', handlePointerOver);
  handleWindowFocus();
  return () => {
    ownerDocument.defaultView?.removeEventListener('focus', handleWindowFocus);
    ownerDocument.removeEventListener('pointerover', handlePointerOver);
  };
}
export function onDocumentFocused(ownerDocument: Document, onFocused: () => void): () => void {
  let notifyIfFocused = () => {
    if (ownerDocument.hasFocus()) onFocused();
  };
  ownerDocument.defaultView?.addEventListener('focus', notifyIfFocused);
  notifyIfFocused();
  return () => ownerDocument.defaultView?.removeEventListener('focus', notifyIfFocused);
}
export function nextGonePaneRoom(previous: GonePaneRoom, current: PaneRoomNow): GonePaneRoom {
  let paneJustGone = previous.wasPaneDrawn && !current.isPaneDrawn;
  let isKept =
    current.isChatOverBar && !current.isPaneDrawn && (paneJustGone ? !current.hasPageKeyboard && previous.wasPersonAtPane : previous.isKept);
  let wasPersonAtPane = current.isPaneDrawn && (previous.wasPersonAtPane || previous.isKept || current.hasPageKeyboard);
  return isKept === previous.isKept && current.isPaneDrawn === previous.wasPaneDrawn && wasPersonAtPane === previous.wasPersonAtPane
    ? previous
    : {
        wasPaneDrawn: current.isPaneDrawn,
        wasPersonAtPane,
        isKept,
      };
}
export function useRoomKeptForGonePane({
  isPaneDrawn,
  isChatOverBar,
  isMenuOpen,
  bar,
}: RoomForGonePaneAsked): boolean {
  let [storedRoom, setRoom] = React.useState<GonePaneRoom>({
    wasPaneDrawn: isPaneDrawn,
    wasPersonAtPane: false,
    isKept: false,
  });
  let room = nextGonePaneRoom(storedRoom, {
    isPaneDrawn,
    isChatOverBar,
    hasPageKeyboard:
      bar === null || bar.ownerDocument.hasFocus() || bar.ownerDocument.documentElement.hasAttribute(NO_ROOM_KEPT_FOR_GONE_PANE_ATTRIBUTE),
  });
  if (room !== storedRoom) setRoom(room);
  let { isKept } = room;
  let awaitsPersonAtPane = room.wasPaneDrawn && !room.wasPersonAtPane;
  React.useEffect(
    () =>
      awaitsPersonAtPane && bar !== null
        ? onDocumentFocused(
            bar.ownerDocument,
            () =>
              setRoom(
                (previous) =>
                  previous.wasPaneDrawn && !previous.wasPersonAtPane
                    ? {
                        ...previous,
                        wasPersonAtPane: true,
                      }
                    : previous,
              ),
          )
        : undefined,
    [awaitsPersonAtPane, bar],
  );
  React.useEffect(
    () =>
      isKept && !isMenuOpen && bar !== null
        ? onPointerAwayWhileFocused(
            bar,
            () =>
              setRoom(
                (previous) => ({
                  ...previous,
                  isKept: false,
                }),
              ),
          )
        : undefined,
    [isKept, isMenuOpen, bar],
  );
  return isKept;
}
export const NO_ROOM_KEPT_FOR_GONE_PANE_ATTRIBUTE = 'data-no-room-kept-for-gone-pane';
