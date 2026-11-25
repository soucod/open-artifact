import { Surface } from '../kit/surface.tsx';
import { useReducedMotion } from '../kit/platform.ts';
import { useUiWindow } from '../kit/theme.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { pointInZoomedElement } from '../grid/zoom.ts';
import { Fragment } from 'react/jsx-runtime';
import { RidingRowsDrawing } from '../grid/grid-drawing.tsx';
import { agentUpdatedCellsText } from '../i18n/agent-turn-labels.ts';
import { MODIFIER_KEYS } from '../state/escape.ts';
import { CELLS_AREA_SELECTOR } from '../ui/leave-cells-hint.tsx';
import { PRESS_READY_DELAY_MS } from '../ui/list-under-cell.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { GridView } from '../grid/grid-view.ts';
import type { GridPoint } from '../grid/geometry.ts';
import type { ColumnGripOfTable } from '../selection/move-table-columns.ts';
import type { CellId } from '../model/workbook.ts';
import type { DoneByAgent } from '../state/initial-state.ts';
import type { UndoOfferShown } from '../editor/entry-field.tsx';
import type { Wait } from '../state/calculating-shown.ts';
/** A value still shown, and whether it is leaving because it is gone. */
export interface Lingering<Value> {
  shown: Value;
  isLeaving: boolean;
}
/** Where the pointer is in the window. */
type PointerAt = Pick<MouseEvent, 'clientX' | 'clientY'>;
interface ColumnGripCalledArgs {
  drawn: Pick<GridView, 'headingsOfColumns' | 'body'>;
  gridRef: React.RefObject<HTMLElement | null>;
  zoom: number;
}
interface ColumnGripsProps {
  grid: Pick<GridView, 'headingsOfColumns' | 'body'>;
  calledFor: string | null;
}
interface ColumnsRidingProps {
  grid: Pick<GridView, 'columnsRiding' | 'body' | 'density'>;
  gridRef: React.RefObject<HTMLElement | null>;
  zoom: number;
}
interface DoneByAgentCardProps {
  done: DoneByAgent | null;
}
/** The kinds of events that tell the person is at the page. */
type PersonActKind = 'pointermove' | 'pointerdown' | 'wheel' | 'keydown';
/** What of a pointer, wheel or key event tells the person acted. */
interface PersonAct extends Pick<Event, 'type'> {
  target: (EventTarget & Partial<Pick<Element, 'matches'>>) | null;
  screenX?: number;
  screenY?: number;
  key?: string;
}
/** The offer the undo card shows: the change to undo and the words of its button. */
export type UndoOfferOnCard = Pick<UndoOfferShown, 'key' | 'title' | 'undoLabel'>;
interface UndoAgentTurnSurfaceProps {
  ref?: React.Ref<HTMLDivElement>;
  offer: UndoOfferOnCard;
  isLeaving: boolean;
  isBeingTaken: boolean;
  onTaken: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  onLeftAlone: () => void;
  /** How long the card is to be seen still before it counts as seen, or null for no such wait. */
  wait: Wait | null;
  onGoneWithKeyboard: () => void;
  onSeenLongEnough: (wait: Wait) => void;
}
interface UndoAgentTurnCardProps extends Omit<UndoAgentTurnSurfaceProps, 'offer' | 'isLeaving'> {
  offer: UndoOfferOnCard | null;
}
export function useLingeringValue<Value>(value: Value | null): Lingering<Value> | null {
  let [lingering, setLingering] = React.useState<Value | null>(value);
  if (value !== null && value !== lingering) setLingering(value);
  React.useEffect(() => {
    if (value !== null || lingering === null) return;
    let timer = setTimeout(() => setLingering(null), CARD_LINGER_MS);
    return () => clearTimeout(timer);
  }, [value, lingering]);
  return lingeringShown(lingering, value);
}
export function cellOfGripPressed(target: EventTarget | null, { headingsOfColumns }: Pick<GridView, 'headingsOfColumns'>): CellId | undefined {
  let key = (target instanceof Element ? target.closest(`[${GRIP_OF_HEADING_ATTRIBUTE}]`) : null)?.getAttribute(GRIP_OF_HEADING_ATTRIBUTE);
  return headingsOfColumns.find((heading) => heading.key === key)?.cell;
}
export function headingKeyCalledAt(
  point: GridPoint,
  { headingsOfColumns, body }: Pick<GridView, 'headingsOfColumns' | 'body'>,
  calledBefore: string | null,
): string | null {
  let [x, y] = [point.x - body.left, point.y - body.top];
  let calledHeading = headingsOfColumns.find(({ key }) => key === calledBefore);
  if (calledHeading !== undefined) {
    let grip = gripPlaceOfHeading(calledHeading);
    if (x >= grip.left && x < grip.left + COLUMN_GRIP_WIDTH && y >= grip.top && y < grip.top + COLUMN_GRIP_HEIGHT) return calledBefore;
  }
  return (
    headingsOfColumns.find(
      ({ left, top, width, height }) => x >= left && x < left + width && y >= top && y < top + height,
    )?.key ?? null
  );
}
export function useColumnGripCalled({ drawn, gridRef, zoom }: ColumnGripCalledArgs) {
  let pointerRef = React.useRef<PointerAt | null>(null);
  let [calledFor, setCalledFor] = React.useState<string | null>(null);
  let updateCalled = React.useCallback(() => {
    const [pointer, grid] = [pointerRef.current, gridRef.current];
    const isNone = pointer === null || grid === null || drawn.headingsOfColumns.length === 0;
    setCalledFor(
      (calledBefore) => (isNone ? null : headingKeyCalledAt(pointInZoomedElement(grid, zoom, pointer), drawn, calledBefore)),
    );
  }, [drawn, gridRef, zoom]);
  React.useLayoutEffect(updateCalled, [updateCalled]);
  let pointerMovedTo = React.useCallback(
    (event: PointerAt | null) => {
      pointerRef.current =
        event === null
          ? null
          : {
              clientX: event.clientX,
              clientY: event.clientY,
            };
      updateCalled();
    },
    [updateCalled],
  );
  return {
    calledFor,
    pointerMovedTo,
  };
}
export function ColumnGrips({ grid: { headingsOfColumns, body }, calledFor }: ColumnGripsProps) {
  return <>{headingsOfColumns.map((heading) => {
      let isCalled = heading.key === calledFor;
      let { left, top } = gripPlaceOfHeading(heading);
      return (<React.Fragment key={heading.key}><div aria-hidden className="sheet-grip-of-column" data-is-called={isCalled ? '' : undefined} {...(isCalled && {
                [GRIP_OF_HEADING_ATTRIBUTE]: heading.key,
              })} style={{
                left: body.left + left,
                top: body.top + top,
              }} /><div aria-hidden className="sheet-extent-of-column" style={{
                left: body.left + heading.left,
                width: heading.width,
                top: body.top + heading.extent.from,
                height: heading.extent.to - heading.extent.from,
              }} /></React.Fragment>);
    })}</>;
}
export function useColumnsMovedAnimation(columnsRiding: GridView['columnsRiding'], gridRef: React.RefObject<HTMLElement | null>): void {
  let isReducedMotion = useReducedMotion();
  let previousRef = React.useRef<GridView['columnsRiding']>(null);
  React.useLayoutEffect(() => {
    let [previous, grid] = [previousRef.current, gridRef.current];
    previousRef.current = columnsRiding;
    if (previous === null || columnsRiding === null || grid === null || previous.key !== columnsRiding.key) return;
    if (isReducedMotion) return;
    let leftBefore = new Map(previous.order.map(({ holdsCellsOf, left }) => [holdsCellsOf, left]));
    let moves = columnsRiding.order.flatMap(({ columnIndex, holdsCellsOf, left }) => {
      let by = (leftBefore.get(holdsCellsOf) ?? left) - left;
      return by === 0
        ? []
        : [
            {
              columnIndex,
              by,
            },
          ];
    });
    if (moves.length === 0) return;
    for (let row of grid.querySelectorAll('.sheet-row')) {
      let rowIndex = Number(row.getAttribute('aria-rowindex')) - 2;
      if (rowIndex < columnsRiding.firstRowIndex || rowIndex > columnsRiding.lastRowIndex) continue;
      if (row.closest('.sheet-columns-riding') !== null) continue;
      for (let { columnIndex, by } of moves)
        row.querySelector(`:scope > [aria-colindex="${columnIndex + 2}"]:not([data-is-in-hand])`)?.animate(
          [
            {
              transform: `translateX(${by}px)`,
            },
            {
              transform: 'none',
            },
          ],
          COLUMNS_RIDE_ANIMATION,
        );
    }
  }, [columnsRiding, gridRef, isReducedMotion]);
}
export function ColumnsRiding({
  grid: { columnsRiding, body, density },
  gridRef,
  zoom,
}: ColumnsRidingProps) {
  useColumnsMovedAnimation(columnsRiding, gridRef);
  let lingeringRiding = useLingeringValue(columnsRiding);
  let copyRef = React.useRef<HTMLDivElement | null>(null);
  let pointerXRef = React.useRef<number | null>(null);
  let bodyLeft = body.left;
  let placeCopy = React.useCallback(() => {
    let [copy, pointerX] = [copyRef.current, pointerXRef.current];
    if (copy === null || columnsRiding === null) return;
    let left =
      pointerX === null
        ? columnsRiding.homeLeft
        : Math.max(
            columnsRiding.leastLeft,
            Math.min(pointerX - columnsRiding.gripFromLeft - bodyLeft, columnsRiding.endOfRun - columnsRiding.room.width),
          );
    copy.style.translate = `${left - columnsRiding.room.left}px 0`;
  }, [bodyLeft, columnsRiding]);
  React.useLayoutEffect(placeCopy, [placeCopy]);
  let placeCopyRef = React.useRef(placeCopy);
  React.useLayoutEffect(() => void (placeCopyRef.current = placeCopy), [placeCopy]);
  let ridingKey = columnsRiding?.key ?? null;
  React.useEffect(() => {
    let grid = gridRef.current;
    let view = grid?.ownerDocument.defaultView ?? null;
    if (ridingKey === null || grid === null || view === null) return;
    pointerXRef.current = null;
    let onPointerMove = (event: PointerEvent) => {
      pointerXRef.current = pointInZoomedElement(grid, zoom, event).x;
      placeCopyRef.current();
    };
    view.addEventListener('pointermove', onPointerMove, true);
    return () => view.removeEventListener('pointermove', onPointerMove, true);
  }, [ridingKey, gridRef, zoom]);
  let bodyBox = React.useMemo(
    () => ({
      left: body.left,
      top: body.top,
      width: body.width,
      height: body.height,
    }),
    [body.left, body.top, body.width, body.height],
  );
  if (lingeringRiding === null) return null;
  let { shown, isLeaving } = lingeringRiding;
  let { room, rows, borderLines } = shown;
  let roomBox = {
    left: bodyBox.left + room.left,
    top: bodyBox.top + room.top,
    width: room.width,
    height: room.height,
  };
  return <div aria-hidden inert className="sheet-columns-riding" data-is-leaving={isLeaving || undefined}>{!isLeaving &&
        <div className="sheet-room-for-columns-riding" style={roomBox} />}<div ref={copyRef} className="sheet-copy-of-columns-riding" style={{
          ...roomBox,
          ...(isLeaving && {
            translate: '0 0',
          }),
        }}><div className="sheet-cells-of-columns-riding"><div style={{
                position: 'absolute',
                left: -bodyBox.left,
                top: -bodyBox.top,
                width: bodyBox.left + room.width,
              }}><RidingRowsDrawing rows={rows} borderLines={borderLines} body={bodyBox} density={density} /></div></div><div className="sheet-grip-of-column" data-is-called="" data-is-held="" style={{
              left: room.width / 2 - COLUMN_GRIP_WIDTH / 2,
              top: -COLUMN_GRIP_HEIGHT / 2,
            }} /></div></div>;
}
export function DoneByAgentCard({ done }: DoneByAgentCardProps) {
  let lingeringDone = useLingeringValue(done);
  if (lingeringDone === null) return null;
  return <Surface aria-hidden elevation="panel" className="sheet-done-by-agent" data-is-leaving={lingeringDone.isLeaving || undefined}><span className="text-secondary">{agentUpdatedCellsText(lingeringDone.shown)}</span></Surface>;
}
export function watchPersonActs(doc: Document, onAct: (isActing: boolean, isKeyInCells: boolean) => void): () => void {
  let lastPointerAt: string | null = null;
  let onEvent = (event: PersonAct) => {
    let { type, screenX, screenY, key = '' } = event;
    let [pointerBefore, pointerNow] = [lastPointerAt, `${screenX} ${screenY}`];
    if (type === 'pointermove') lastPointerAt = pointerNow;
    if (type === 'keydown' && MODIFIER_KEYS.has(key)) return;
    let isInCells = event.target?.matches?.(CELLS_AREA_SELECTOR) === true;
    if (type !== 'pointermove' || (pointerBefore !== null && pointerBefore !== pointerNow)) onAct(true, type === 'keydown' && isInCells);
  };
  let onGone = () => {
    lastPointerAt = null;
    onAct(false, false);
  };
  let onMouseLeave = () => {
    if (!doc.hasFocus()) onGone();
  };
  let onVisibilityChange = () => {
    if (doc.visibilityState === 'hidden') onGone();
  };
  for (let eventType of PERSON_ACT_EVENTS) doc.addEventListener(eventType, onEvent, PERSON_ACT_LISTEN_OPTIONS);
  doc.addEventListener('visibilitychange', onVisibilityChange);
  doc.documentElement.addEventListener('mouseleave', onMouseLeave);
  doc.defaultView?.addEventListener('blur', onGone);
  return () => {
    for (let eventType of PERSON_ACT_EVENTS) doc.removeEventListener(eventType, onEvent, PERSON_ACT_LISTEN_OPTIONS);
    doc.removeEventListener('visibilitychange', onVisibilityChange);
    doc.documentElement.removeEventListener('mouseleave', onMouseLeave);
    doc.defaultView?.removeEventListener('blur', onGone);
  };
}
export function takePressesAfterDelay(element: Element, view: Window): () => void {
  element.removeAttribute('data-takes-presses');
  let timer: number | undefined;
  let frame = view.requestAnimationFrame(() => {
    timer = view.setTimeout(() => element.setAttribute('data-takes-presses', ''), PRESS_READY_DELAY_MS);
  });
  return () => {
    view.cancelAnimationFrame(frame);
    view.clearTimeout(timer);
  };
}
export function UndoAgentTurnCard({ offer, ...cardProps }: UndoAgentTurnCardProps) {
  let lingeringOffer = useLingeringValue(offer);
  if (lingeringOffer === null) return null;
  return <UndoAgentTurnSurface key={lingeringOffer.shown.key} offer={lingeringOffer.shown} isLeaving={lingeringOffer.isLeaving} {...cardProps} />;
}
export function UndoAgentTurnSurface({
  ref,
  offer,
  isLeaving,
  isBeingTaken,
  onTaken,
  onKeyDown,
  onLeftAlone,
  wait,
  ...restProps
}: UndoAgentTurnSurfaceProps) {
  let { title, undoLabel } = offer;
  let undoButtonRef = React.useRef<HTMLElement | null>(null);
  let titleId = React.useId();
  let onGoneWithKeyboard = React.useEffectEvent(restProps.onGoneWithKeyboard);
  let onSeenLongEnough = React.useEffectEvent(restProps.onSeenLongEnough);
  let [actCount, setActCount] = React.useState<number | null>(null);
  let [isPointerIn, setIsPointerIn] = React.useState(false);
  let [isFocusIn, setIsFocusIn] = React.useState(false);
  React.useEffect(() => {
    let doc = undoButtonRef.current?.ownerDocument;
    if (doc === undefined) return;
    return watchPersonActs(doc, (...act: [isActing: boolean, isKeyInCells: boolean]) => setActCount((count) => nextActCount(count, ...act)));
  }, []);
  let stillCount = actCountUnlessHeld(actCount, isPointerIn, isFocusIn, isBeingTaken, isLeaving);
  let view = useUiWindow();
  React.useEffect(() => {
    if (stillCount === null || wait === null || view === undefined) return;
    let timer = view.setTimeout(() => onSeenLongEnough(wait), wait.ms);
    return () => view.clearTimeout(timer);
  }, [stillCount, wait, view]);
  React.useLayoutEffect(() => {
    let undoButton = undoButtonRef.current;
    let tellIfCaretGone = () => {
      if (undoButton !== null && undoButton === undoButton.ownerDocument.activeElement) onGoneWithKeyboard();
    };
    if (isLeaving) tellIfCaretGone();
    return tellIfCaretGone;
  }, [isLeaving]);
  return <Surface ref={ref} elevation="panel" className="sheet-done-by-agent" data-has-undo data-is-leaving={isLeaving || undefined} onKeyDown={onKeyDown} onPointerEnter={() => setIsPointerIn(true)} onPointerLeave={() => {
      setIsPointerIn(false);
      onLeftAlone();
    }} onFocus={() => setIsFocusIn(true)} onBlur={() => {
      setIsFocusIn(false);
      onLeftAlone();
    }}><div className="contents" inert={isLeaving}><span id={titleId} className="text-secondary">{title}</span><Button ref={undoButtonRef} variant="ghost" size="sm" aria-label={undoLabel} aria-describedby={titleId} busy={isBeingTaken} onClick={({ currentTarget }) => {
            if (currentTarget.closest('[data-takes-presses]') !== null) onTaken();
          }}>{sheetMessages.undo()}</Button></div></Surface>;
}
export const CARD_LINGER_MS = 200;
export const lingeringShown = <Value,>(lingered: Value | null, current: Value | null): Lingering<Value> | null =>
  current !== null
    ? {
        shown: current,
        isLeaving: false,
      }
    : lingered === null
      ? null
      : {
          shown: lingered,
          isLeaving: true,
        };
export const COLUMN_GRIP_WIDTH = 24;
export const COLUMN_GRIP_HEIGHT = 14;
export const GRIP_OF_HEADING_ATTRIBUTE = 'data-grip-of-heading';
export const gripPlaceOfHeading = ({ left, top, width }: Pick<ColumnGripOfTable, 'left' | 'top' | 'width'>): Pick<ColumnGripOfTable, 'left' | 'top'> => ({
  left: left + width / 2 - COLUMN_GRIP_WIDTH / 2,
  top: top - COLUMN_GRIP_HEIGHT / 2,
});
export const COLUMNS_RIDE_ANIMATION = {
  duration: 200,
  easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
};
export const PERSON_ACT_EVENTS: readonly PersonActKind[] = ['pointermove', 'pointerdown', 'wheel', 'keydown'];
export const PERSON_ACT_LISTEN_OPTIONS = {
  capture: true,
  passive: true,
};
export const nextActCount = (count: number | null, isActing: boolean, isKeyInCells: boolean): number | null => {
  if (!isActing) return null;
  return count === null || isKeyInCells ? (count ?? 0) + 1 : count;
};
export const actCountUnlessHeld = (count: number | null, ...holds: boolean[]): number | null => (holds.includes(true) ? null : count);
