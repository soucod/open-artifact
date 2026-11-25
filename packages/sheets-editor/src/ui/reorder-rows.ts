import * as React from 'react';
import type { OptionRowLetGo, ReorderedRowProps } from '../chips/dropdown-list.tsx';
/** The way rows run in a list: one under another, or side by side. */
export type ReorderWay = 'down' | 'across';
/** What a drag of a row is doing: pressed but not yet taken, held, or landing in its new place. */
export type RowDragPhase = 'pressed' | 'held' | 'landing';
/** What part of the row was pressed to start the drag. */
export type RowPressedOn = 'rowItself' | 'handle';
/** The end of the list a drag has gone past, if any. */
export type RowStoppedAt = 'first' | 'last' | null;
/** A row being dragged, as drawn: which row, from where to where, and the lengths of all the rows. */
export interface RowDrag<Key = string | number> {
  key: Key;
  from: number;
  to: number;
  lengths: number[];
  phase: RowDragPhase;
}
/** A stretch along the list's axis, from its start to its end. */
export interface SpanOnAxis {
  start: number;
  end: number;
}
/** Where a row starts along the list's axis, and how long it is. */
export interface RowOnAxis {
  start: number;
  length: number;
}
/** Where a drag of a row is taking it. */
export interface ReorderTarget {
  travel: number;
  to: number;
  stoppedAt: RowStoppedAt;
}
/** A press on a row, followed until it is let go. */
interface RowPress<Key> {
  pointerId: number;
  key: Key;
  from: number;
  row: HTMLElement;
  scroller: HTMLElement | null;
  lengths: number[];
  pressedAt: number;
  /** How far the row reached outside the scroller's room when it was taken. */
  reachWhenTaken: SpanOnAxis | null;
  scrolledAtPress: number;
  pointerAt: number;
  pressed: RowPressedOn;
  isRowTaken: boolean;
  hasMoved: boolean;
  hasLeftItsPlace: boolean;
  mayScrollToStart: boolean;
  mayScrollToEnd: boolean;
  to: number;
  stoppedAt: RowStoppedAt;
  holder: HTMLElement;
}
/** How a row was let go: dropped, or the drag called off. */
export type RowLetGoHow = OptionRowLetGo['how'];
/** The names of the sides, sizes and styles along one way of the list. */
export interface ReorderAxis {
  pointer: 'clientY' | 'clientX';
  start: 'top' | 'left';
  end: 'bottom' | 'right';
  length: 'height' | 'width';
  scrolled: 'scrollTop' | 'scrollLeft';
  overflow: 'overflowY' | 'overflowX';
  translate: 'translateY' | 'translateX';
}
export interface ReorderRowsProps<Key extends string | number> {
  listRef: React.RefObject<HTMLElement | null>;
  /** The key of each row, in the list's order; empty when the rows cannot be reordered. */
  keys: Key[];
  way?: ReorderWay;
  onMoved: (key: Key, toIndex: number, onDone: (hasMoved: boolean) => void) => void;
  onDragEnded?: (letGo: Omit<OptionRowLetGo, 'key'> & { key: Key }) => void;
  isRowPutBackPressed?: boolean;
  /** The room to keep free at each end of the scroller, or `null` to let the row go anywhere in it. */
  roomKeptAtEnds?: (scroller: HTMLElement, rowLength: number) => SpanOnAxis | null;
}
export function stepsTravelled(lengths: number[], from: number, step: number, distance: number): number {
  let [steps, travelled] = [0, 0];
  for (let index = from + step; index >= 0 && index < lengths.length; index += step) {
    let rowLength = lengths[index] ?? 0;
    if (distance <= travelled + rowLength / 2) break;
    steps += 1;
    travelled += rowLength;
  }
  return steps;
}
export function reorderTarget(drag: Pick<RowDrag, 'from' | 'lengths'> & { travel: number }): ReorderTarget {
  let { from, lengths } = drag;
  let [mostBack, mostOn] = [-sumOf(lengths.slice(0, from)), sumOf(lengths.slice(from + 1))];
  let travel = Math.max(mostBack, Math.min(drag.travel, mostOn));
  let way = travel < 0 ? -1 : 1;
  let to = from + way * stepsTravelled(lengths, from, way, Math.abs(travel));
  let stoppedAt: RowStoppedAt = drag.travel <= mostBack ? 'first' : drag.travel >= mostOn ? 'last' : null;
  return {
    travel,
    to,
    stoppedAt,
  };
}
export function reachOutside(row: RowOnAxis, room: SpanOnAxis): SpanOnAxis {
  return {
    start: Math.max(0, room.start - row.start),
    end: Math.max(0, row.start + row.length - room.end),
  };
}
export function clampTravelToRoom(drag: { wanted: number; length: number }, room: SpanOnAxis, outside: SpanOnAxis): number {
  let least = room.start - outside.start;
  return Math.max(least, Math.min(drag.wanted, room.end + outside.end - drag.length));
}
export function autoScrollSpeed(pointerAt: number, { start, end }: SpanOnAxis): number {
  let edge = Math.min(AUTO_SCROLL_EDGE, (end - start) / 3);
  if (edge <= 0) return 0;
  let [intoStart, intoEnd] = [start + edge - pointerAt, pointerAt - (end - edge)];
  if (intoStart > 0) return -AUTO_SCROLL_MAX_SPEED * Math.min(1, intoStart / edge);
  return intoEnd > 0 ? AUTO_SCROLL_MAX_SPEED * Math.min(1, intoEnd / edge) : 0;
}
export function reorderRowProps<Key>(drag: RowDrag<Key> | null, key: Key, index: number, way: ReorderWay = 'down'): Omit<ReorderedRowProps, 'className'> {
  if (drag === null || drag.phase === 'pressed') return {};
  if (drag.key === key)
    return {
      'data-reorder': drag.phase,
    };
  if (drag.phase === 'landing') return {};
  let shift = shiftOfRow(index, drag);
  let offset = shift * (drag.lengths[drag.from] ?? 0);
  return shift === 0
    ? {}
    : {
        style: {
          transform: `${REORDER_AXES[way].translate}(${offset}px)`,
        },
      };
}
export function scrollerAround(element: HTMLElement, way: ReorderWay): HTMLElement | null {
  for (let ancestor = element.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    let overflow = getComputedStyle(ancestor)[REORDER_AXES[way].overflow];
    if (overflow === 'auto' || overflow === 'scroll') return ancestor;
  }
  return null;
}
export function swallowNextClick(view: Window, isByKey: boolean) {
  let listenerOptions = {
    capture: true,
  };
  let stopSwallowing = () => {
    view.removeEventListener('click', swallow, listenerOptions);
    view.removeEventListener('pointerdown', stopSwallowing, listenerOptions);
    view.removeEventListener('keydown', stopSwallowing, listenerOptions);
  };
  let swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    stopSwallowing();
  };
  view.addEventListener('click', swallow, listenerOptions);
  view.addEventListener('pointerdown', stopSwallowing, listenerOptions);
  if (!isByKey) view.addEventListener('keydown', stopSwallowing, listenerOptions);
}
export function autoScrollSpeedOf({ pointerAt, scroller }: { pointerAt: number; scroller: HTMLElement | null }, way: ReorderWay): number {
  if (scroller === null) return 0;
  let bounds = scroller.getBoundingClientRect();
  return autoScrollSpeed(pointerAt, {
    start: bounds[REORDER_AXES[way].start],
    end: bounds[REORDER_AXES[way].end],
  });
}
/** How a list's rows are pressed, dragged and drawn while they can be reordered. */
export interface ReorderRows<Key> {
  areTooltipsOfHandlesShut: boolean;
  /** Runs a change that moves rows, and glides the rows to their new places once it is done. */
  gliding(move: (onDone: (hasMoved: boolean) => void) => void, onLanded: (hasMoved: boolean) => void): void;
  /** The props of a row; `null` for a row with no key yet, which is never the one dragged. */
  ofRow(key: Key | null, index: number): ReorderedRowProps;
  isRowHeld: boolean;
  pressOnRowItself(event: React.PointerEvent<HTMLElement>, key: Key, index: number): void;
  ofHandle(key: Key, index: number): ReorderHandleProps;
}
/** The props of a row's handle, by which it is dragged or moved with the arrow keys. */
export interface ReorderHandleProps {
  className: string;
  [REORDER_HANDLE_ATTRIBUTE]: true;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}
export function useReorderRows<Key extends string | number>({
  listRef,
  keys,
  way = 'down',
  onMoved,
  onDragEnded,
  isRowPutBackPressed = true,
  roomKeptAtEnds,
}: ReorderRowsProps<Key>): ReorderRows<Key> {
  let [drag, setDrag] = React.useState<RowDrag<Key> | null>(null);
  let [areHandleTooltipsShut, setHandleTooltipsShut] = React.useState(false);
  let pressRef = React.useRef<RowPress<Key> | null>(null);
  if (drag !== null && drag.phase !== 'landing' && keys[drag.from] !== drag.key) {
    setDrag(null);
    setHandleTooltipsShut(false);
  }
  let startsBeforeRef = React.useRef<Map<HTMLElement, number> | null>(null);
  React.useLayoutEffect(() => {
    let startsBefore = startsBeforeRef.current;
    startsBeforeRef.current = null;
    if (startsBefore === null) return;
    let rows = [...startsBefore.keys()].filter((row) => row.isConnected);
    for (let row of rows) {
      row.style.removeProperty(REORDER_TRAVEL_PROPERTY);
      row.style.transition = 'none';
    }
    let { start: startSide, translate } = REORDER_AXES[way];
    let shifts = rows.map((row) => (startsBefore.get(row) ?? 0) - row.getBoundingClientRect()[startSide]);
    for (let [index, row] of rows.entries()) row.style.transform = `${translate}(${shifts[index] ?? 0}px)`;
    listRef.current?.getBoundingClientRect();
    for (let row of rows) {
      row.style.transition = '';
      row.style.transform = '';
    }
    if (drag?.phase !== 'landing') return;
    let landing = drag;
    let animations = rows.find((row) => row.dataset.reorder !== undefined)?.getAnimations() ?? [];
    Promise.allSettled(animations.map(({ finished }) => finished)).then(
      () => setDrag((dragNow) => (dragNow === landing ? null : dragNow)),
    );
  });
  let latestRef = React.useRef({
    keys,
    onMoved,
    onDragEnded,
    isRowPutBackPressed,
    roomKeptAtEnds,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      keys,
      onMoved,
      onDragEnded,
      isRowPutBackPressed,
      roomKeptAtEnds,
    };
  });
  let isHeld = drag?.phase === 'held';
  let isPressed = isHeld || drag?.phase === 'pressed';
  React.useEffect(() => {
    let view = listRef.current?.ownerDocument.defaultView ?? null;
    if (!isPressed || view === null) return;
    let clampTravel = (pressNow: RowPress<Key>, travel: number) => {
      let [list, rowLength] = [listRef.current, pressNow.lengths[pressNow.from] ?? 0];
      if (list === null || pressNow.scroller === null) return travel;
      let roomKept = latestRef.current.roomKeptAtEnds?.(pressNow.scroller, rowLength) ?? null;
      if (roomKept === null) return travel;
      let { start: startSide, end: endSide } = REORDER_AXES[way];
      let bounds = pressNow.scroller.getBoundingClientRect();
      let room = {
        start: bounds[startSide] + roomKept.start,
        end: bounds[endSide] - roomKept.end,
      };
      let rowStart = list.getBoundingClientRect()[startSide] + sumOf(pressNow.lengths.slice(0, pressNow.from));
      pressNow.reachWhenTaken ??= reachOutside(
        {
          start: rowStart,
          length: rowLength,
        },
        room,
      );
      let wantedStart = rowStart + travel;
      return (
        clampTravelToRoom(
          {
            wanted: wantedStart,
            length: rowLength,
          },
          room,
          pressNow.reachWhenTaken,
        ) - rowStart
      );
    };
    let followPointer = () => {
      let pressNow = pressRef.current;
      if (pressNow === null || !pressNow.isRowTaken) return;
      let scrolledSincePress = (pressNow.scroller?.[REORDER_AXES[way].scrolled] ?? 0) - pressNow.scrolledAtPress;
      let {
        travel,
        to,
        stoppedAt,
      } = reorderTarget({
        from: pressNow.from,
        lengths: pressNow.lengths.slice(0, latestRef.current.keys.length),
        travel: pressNow.pointerAt - pressNow.pressedAt + scrolledSincePress,
      });
      pressNow.row.style.setProperty(REORDER_TRAVEL_PROPERTY, `${clampTravel(pressNow, travel)}px`);
      [pressNow.to, pressNow.stoppedAt] = [to, stoppedAt];
      pressNow.hasLeftItsPlace ||= to !== pressNow.from;
      setDrag(
        (dragNow) =>
          dragNow === null || dragNow.to === to
            ? dragNow
            : {
                ...dragNow,
                to,
              },
      );
    };
    let endPress = (how: RowLetGoHow, isByKey: boolean = false, letGoAt: Pick<PointerEvent, 'clientX' | 'clientY'> | null = null) => {
      let pressNow = pressRef.current;
      if (pressNow === null) return;
      pressRef.current = null;
      if (!pressNow.isRowTaken) {
        setDrag(null);
        return;
      }
      let isLetGoOverRow = letGoAt !== null && isPointInRect(pressNow.row.getBoundingClientRect(), letGoAt);
      let { key, from, to, lengths, holder, pointerId, hasMoved } = pressNow;
      if (holder.hasPointerCapture(pointerId)) holder.releasePointerCapture(pointerId);
      let isPutBack = isPutBackPress({
        how,
        isBackInItsPlace: to === from,
        isRowPutBackPressed: latestRef.current.isRowPutBackPressed,
      });
      if (pressNow.pressed === 'rowItself' && !isPutBack) swallowNextClick(view, isByKey);
      let land = () => {
        startsBeforeRef.current = rowStartsOf(listRef.current, way);
        pressNow.row.style.transition = 'none';
        setDrag({
          key,
          from,
          to,
          lengths,
          phase: 'landing',
        });
      };
      if (how === 'dropped' && hasMoved && to !== from) latestRef.current.onMoved(key, to, land);
      else land();
      let { hasLeftItsPlace } = pressNow;
      latestRef.current.onDragEnded?.({
        key,
        how,
        hasLeftItsPlace,
        isLetGoOverRow,
      });
    };
    let isOwnPointer = ({ pointerId }: PointerEvent) => pointerId === pressRef.current?.pointerId;
    let onPointerMove = (event: PointerEvent) => {
      let pressNow = pressRef.current;
      if (pressNow === null || !isOwnPointer(event)) return;
      if (event.buttons === 0) {
        endPress('canceled');
        return;
      }
      pressNow.pointerAt = event[REORDER_AXES[way].pointer];
      let travel = pressNow.pointerAt - pressNow.pressedAt;
      if (!pressNow.isRowTaken) {
        if (!isFarEnoughToTake(travel)) return;
        pressNow.isRowTaken = true;
        pressNow.holder.setPointerCapture(pressNow.pointerId);
        setDrag(
          (dragNow) =>
            dragNow === null
              ? dragNow
              : {
                  ...dragNow,
                  phase: 'held',
                },
        );
      }
      pressNow.hasMoved ||= Math.abs(travel) >= REORDER_MOVE_SLOP;
      let scrollSpeed = autoScrollSpeedOf(pressNow, way);
      pressNow.mayScrollToStart ||= mayAutoScroll(-1, scrollSpeed, travel);
      pressNow.mayScrollToEnd ||= mayAutoScroll(1, scrollSpeed, travel);
      followPointer();
    };
    let onPointerUp = (event: PointerEvent) => {
      if (isOwnPointer(event)) endPress('dropped', false, event);
    };
    let onPointerCancel = (event: PointerEvent) => {
      if (isOwnPointer(event)) endPress('canceled');
    };
    let cancel = () => endPress('canceled');
    let noteMoved = () => {
      if (pressRef.current !== null) pressRef.current.hasMoved = true;
    };
    let onKeyDown = (event: KeyboardEvent) => {
      if (isScrollKey(event)) noteMoved();
      if (event.key !== 'Escape' || pressRef.current?.isRowTaken !== true) return;
      event.preventDefault();
      event.stopPropagation();
      endPress('canceled', true);
    };
    let onScroll = () => followPointer();
    let listenerOptions = {
      capture: true,
    };
    view.addEventListener('pointermove', onPointerMove, listenerOptions);
    view.addEventListener('pointerup', onPointerUp, listenerOptions);
    view.addEventListener('pointercancel', onPointerCancel, listenerOptions);
    view.addEventListener('lostpointercapture', onPointerCancel, listenerOptions);
    view.addEventListener('pointerdown', cancel, listenerOptions);
    view.addEventListener('keydown', onKeyDown, listenerOptions);
    view.addEventListener('scroll', onScroll, listenerOptions);
    view.addEventListener('wheel', noteMoved, {
      capture: true,
      passive: true,
    });
    view.addEventListener('blur', cancel);
    let [lastFrameAt, scrollCarry] = [view.performance.now(), 0];
    let autoScrollFrame = (frameAt: number) => {
      frameRequest = view.requestAnimationFrame(autoScrollFrame);
      let [pressNow, elapsed] = [pressRef.current, frameAt - lastFrameAt];
      lastFrameAt = frameAt;
      if (pressNow === null || pressNow.scroller === null || !pressNow.isRowTaken || !pressNow.hasMoved) return;
      let speed = autoScrollSpeedOf(pressNow, way);
      let mayScroll = speed < 0 ? pressNow.mayScrollToStart : pressNow.mayScrollToEnd;
      if (speed === 0 || !mayScroll || pressNow.stoppedAt === (speed < 0 ? 'first' : 'last')) {
        scrollCarry = 0;
        return;
      }
      scrollCarry += speed * elapsed;
      let scrollStep = Math.trunc(scrollCarry);
      if (scrollStep === 0) return;
      scrollCarry -= scrollStep;
      pressNow.scroller.scrollBy({
        [REORDER_AXES[way].start]: scrollStep,
        behavior: 'instant',
      });
      followPointer();
    };
    let frameRequest = view.requestAnimationFrame(autoScrollFrame);
    return () => {
      view.removeEventListener('pointermove', onPointerMove, listenerOptions);
      view.removeEventListener('pointerup', onPointerUp, listenerOptions);
      view.removeEventListener('pointercancel', onPointerCancel, listenerOptions);
      view.removeEventListener('lostpointercapture', onPointerCancel, listenerOptions);
      view.removeEventListener('pointerdown', cancel, listenerOptions);
      view.removeEventListener('keydown', onKeyDown, listenerOptions);
      view.removeEventListener('scroll', onScroll, listenerOptions);
      view.removeEventListener('wheel', noteMoved, listenerOptions);
      view.removeEventListener('blur', cancel);
      view.cancelAnimationFrame(frameRequest);
      let pressNow = pressRef.current;
      pressRef.current = null;
      pressNow?.row.style.removeProperty(REORDER_TRAVEL_PROPERTY);
      if (pressNow?.holder.hasPointerCapture(pressNow.pointerId) === true) pressNow.holder.releasePointerCapture(pressNow.pointerId);
    };
  }, [isPressed, listRef, way]);
  React.useEffect(() => {
    let view = listRef.current?.ownerDocument.defaultView ?? null;
    if (!areHandleTooltipsShut || isHeld || view === null) return;
    let onPointerMove = ({ target }: PointerEvent) => {
      if (!(target instanceof view.Element) || target.closest(`[${REORDER_HANDLE_ATTRIBUTE}]`) === null) setHandleTooltipsShut(false);
    };
    view.addEventListener('pointermove', onPointerMove);
    return () => view.removeEventListener('pointermove', onPointerMove);
  }, [areHandleTooltipsShut, isHeld, listRef]);
  React.useEffect(() => {
    let list = listRef.current;
    list?.toggleAttribute(IS_REORDERING_ATTRIBUTE, isHeld);
    return () => void list?.toggleAttribute(IS_REORDERING_ATTRIBUTE, false);
  }, [isHeld, listRef]);
  let gliding = (move: (onDone: (hasMoved: boolean) => void) => void, onLanded: (hasMoved: boolean) => void) =>
    move((hasMoved) => {
      if (hasMoved) startsBeforeRef.current = rowStartsOf(listRef.current, way);
      onLanded?.(hasMoved);
    });
  let press = (event: React.PointerEvent<HTMLElement>, key: Key, index: number, pressed: RowPressedOn) => {
    let rows = [...(listRef.current?.children ?? [])];
    let row = rows[index];
    if (event.button !== 0 || event.ctrlKey || !event.isPrimary) return;
    if (pressRef.current !== null || isHeld) return;
    if (!(row instanceof HTMLElement) || keys[index] !== key) return;
    let phase = pressPhase(pressed, event.pointerType);
    if (phase === null) return;
    let takesRowAtOnce = phase === 'held';
    let { pointer: pointerSide, length: lengthSide, scrolled: scrolledSide } = REORDER_AXES[way];
    let scroller = scrollerAround(row, way);
    let lengths = rows.map((rowOfList) => rowOfList.getBoundingClientRect()[lengthSide]);
    if (takesRowAtOnce) event.currentTarget.setPointerCapture(event.pointerId);
    pressRef.current = {
      pointerId: event.pointerId,
      key,
      from: index,
      row,
      scroller,
      lengths,
      pressedAt: event[pointerSide],
      reachWhenTaken: null,
      scrolledAtPress: scroller?.[scrolledSide] ?? 0,
      pointerAt: event[pointerSide],
      pressed,
      isRowTaken: takesRowAtOnce,
      hasMoved: false,
      hasLeftItsPlace: false,
      mayScrollToStart: false,
      mayScrollToEnd: false,
      to: index,
      stoppedAt: null,
      holder: event.currentTarget,
    };
    if (takesRowAtOnce) setHandleTooltipsShut(true);
    setDrag({
      key,
      from: index,
      to: index,
      lengths,
      phase,
    });
  };
  return {
    areTooltipsOfHandlesShut: areHandleTooltipsShut,
    gliding,
    ofRow: (key: Key | null, index: number): ReorderedRowProps => ({
      ...reorderRowProps(drag, key, index, way),
      className: `${REORDER_ROW_CLASS.className} ${REORDER_HELD_TRANSLATE_CLASS[way]}`,
    }),
    isRowHeld: isHeld,
    pressOnRowItself: (event: React.PointerEvent<HTMLElement>, key: Key, index: number) => press(event, key, index, 'rowItself'),
    ofHandle: (key: Key, index: number) => ({
      className: 'cursor-grab touch-none',
      [REORDER_HANDLE_ATTRIBUTE]: true,
      onPointerDown: (event: React.PointerEvent<HTMLElement>) => press(event, key, index, 'handle'),
      onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        if (event.ctrlKey && event.altKey) return;
        event.preventDefault();
        if (event.repeat || pressRef.current !== null || isHeld) return;
        let to = index + (event.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= keys.length) return;
        gliding(
          (onDone) => onMoved(key, to, onDone),
          (hasMoved) => {
            if (hasMoved)
              setDrag({
                key,
                from: to,
                to,
                lengths: [],
                phase: 'landing',
              });
          },
        );
      },
    }),
  };
}
export const AUTO_SCROLL_EDGE = 40;
export const AUTO_SCROLL_MAX_SPEED = 0.6;
export const REORDER_MOVE_SLOP = 3;
export const REORDER_TAKE_DISTANCE = 6;
export const AUTO_SCROLL_ARM_DISTANCE = 12;
export const REORDER_TRAVEL_PROPERTY = '--sheet-reorder-travel';
export const isScrollKey = ({ key }: Pick<KeyboardEvent, 'key'>) =>
  key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End' || key === 'ArrowUp' || key === 'ArrowDown' || key === ' ';
export const IS_REORDERING_ATTRIBUTE = 'data-is-reordering';
export const REORDER_HANDLE_ATTRIBUTE = 'data-reorder-handle';
export const REORDER_AXES: Record<ReorderWay, ReorderAxis> = {
  down: {
    pointer: 'clientY',
    start: 'top',
    end: 'bottom',
    length: 'height',
    scrolled: 'scrollTop',
    overflow: 'overflowY',
    translate: 'translateY',
  },
  across: {
    pointer: 'clientX',
    start: 'left',
    end: 'right',
    length: 'width',
    scrolled: 'scrollLeft',
    overflow: 'overflowX',
    translate: 'translateX',
  },
};
export const sumOf = (numbers: number[]) => numbers.reduce((sum, number) => sum + number, 0);
export const shiftOfRow = (index: number, { from, to }: Pick<RowDrag, 'from' | 'to'>) => {
  if (index > from && index <= to) return -1;
  return index < from && index >= to ? 1 : 0;
};
export const mayAutoScroll = (direction: number, speed: number, travel: number) =>
  speed * direction <= 0 || speed * direction >= AUTO_SCROLL_MAX_SPEED || travel * direction >= AUTO_SCROLL_ARM_DISTANCE;
export const pressPhase = (pressed: RowPressedOn, pointerType: string): RowDragPhase | null =>
  pressed === 'handle' ? 'held' : pointerType === 'touch' ? null : 'pressed';
export const isFarEnoughToTake = (travel: number) => Math.abs(travel) >= REORDER_TAKE_DISTANCE;
export const isPutBackPress = (end: { how: RowLetGoHow; isBackInItsPlace: boolean; isRowPutBackPressed: boolean }) => end.how === 'dropped' && end.isBackInItsPlace && end.isRowPutBackPressed;
export const isPointInRect = (rect: DOMRect, { clientX, clientY }: Pick<PointerEvent, 'clientX' | 'clientY'>) =>
  clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
export const isDropAPressOnRow = ({ how, hasLeftItsPlace, isLetGoOverRow }: Omit<OptionRowLetGo, 'key'>) =>
  how === 'dropped' && !hasLeftItsPlace && isLetGoOverRow;
export const REORDER_ROW_CLASS = {
  className:
    'group/reorder relative isolate transition-[opacity,transform,translate] duration-base ease-out motion-reduce:transition-none data-reorder:z-1 data-[reorder=held]:cursor-grabbing data-[reorder=held]:transition-none',
};
export const REORDER_HELD_TRANSLATE_CLASS: Record<ReorderWay, string> = {
  down: 'data-[reorder=held]:translate-y-(--sheet-reorder-travel)',
  across: 'data-[reorder=held]:translate-x-(--sheet-reorder-travel)',
};
export const REORDER_LIFT_PROPS = {
  'aria-hidden': true,
  className:
    'pointer-events-none absolute inset-x-1 inset-y-0 -z-1 rounded bg-surface-popover opacity-0 shadow-panel-sm transition-opacity duration-snap ease-out motion-reduce:transition-none group-data-reorder/reorder:opacity-100 forced-colors:outline forced-colors:-outline-offset-1',
};
export const rowStartsOf = (list: HTMLElement | null, way: ReorderWay) =>
  new Map(
    [...(list?.children ?? [])]
      .filter((child) => child instanceof HTMLElement)
      .map((child): [HTMLElement, number] => [child, child.getBoundingClientRect()[REORDER_AXES[way].start]]),
  );
