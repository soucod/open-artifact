import { useReducedMotion } from '../kit/platform.ts';
import * as React from 'react';
import { tableHandleUnderPointer } from '../selection/move-cells.ts';
import { pointInZoomedElement } from '../grid/zoom.ts';
import type { GridOfTableHandles, TableHandle as HandleOfTable, TableHandleBox } from '../selection/move-cells.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { DrawnRow } from '../grid/grid-drawing.tsx';
/** Where the pointer last was over the grid, on the page. */
type PointerOnPage = Pick<MouseEvent, 'clientX' | 'clientY'>;
/** What calling up a table's handle by pointing goes by: the drawn grid, the grid's element, and the zoom. */
export interface TableHandleCallSource {
  drawn: GridOfTableHandles;
  gridRef: React.RefObject<HTMLElement | null>;
  zoom: number;
}
/** The table whose handle the pointer calls up, and what tells it where the pointer went and that the handle's menu shut. */
export interface TableHandleCall {
  calledFor: string | null;
  pointerMovedTo: (pointer: PointerOnPage | null) => void;
  menuOfHandleShut: () => void;
}
/** The handle of a table shown, and the one going away as it fades. */
export interface TableHandlesShown {
  called: string | null;
  going: string | null;
}
/** What of the drawn grid the handles of tables are drawn from. */
export interface GridOfHandlesDrawn {
  handlesOfTables: readonly HandleOfTable[];
  body: Pick<PaneRect, 'left' | 'top'>;
  rowsDrawn: readonly Pick<DrawnRow, 'isActive' | 'rowNumber'>[];
}
export interface TableHandleProps {
  grid: GridOfHandlesDrawn;
  calledFor: string | null;
  isMenuOpen: boolean;
}
/** What of the drawn grid tells the row number left under a table's handle. */
export interface GridWithHandleRowNumbers {
  handlesOfTables: readonly HandleOfTable[];
  cellsHeld: { handle: Pick<TableHandleBox, 'rowNumberUnder'> | null } | null;
}
export function useTableHandleCall({ drawn, gridRef, zoom }: TableHandleCallSource): TableHandleCall {
  let pointerRef = React.useRef<PointerOnPage | null>(null);
  let [calledFor, setCalledFor] = React.useState<string | null>(null);
  let recheck = React.useCallback(
    (hasPointerMoved: boolean = false) => {
      const [pointer, grid] = [pointerRef.current, gridRef.current];
      const isNothingToCall = pointer === null || grid === null || drawn.handlesOfTables.length === 0;
      if (isNothingToCall && pointer !== null && !hasPointerMoved) return;
      setCalledFor(
        (previous) =>
          isNothingToCall ? null : tableHandleUnderPointer(pointInZoomedElement(grid, zoom, pointer), drawn, previous),
      );
    },
    [drawn, gridRef, zoom],
  );
  React.useLayoutEffect(recheck, [recheck]);
  let pointerMovedTo = React.useCallback(
    (pointer: PointerOnPage | null) => {
      let previous = pointerRef.current;
      pointerRef.current =
        pointer === null
          ? null
          : {
              clientX: pointer.clientX,
              clientY: pointer.clientY,
            };
      recheck(previous?.clientX !== pointer?.clientX || previous?.clientY !== pointer?.clientY);
    },
    [recheck],
  );
  let menuOfHandleShut = React.useCallback(() => {
    let handle = gridRef.current?.querySelector(`[${TABLE_OF_HANDLE_ATTRIBUTE}]`);
    let tableKey = handle?.getAttribute(TABLE_OF_HANDLE_ATTRIBUTE) ?? null;
    if (handle === null || handle === undefined || tableKey === null) return;
    let { left, top, width, height } = handle.getBoundingClientRect();
    pointerRef.current = {
      clientX: left + width / 2,
      clientY: top + height / 2,
    };
    setCalledFor(tableKey);
  }, [gridRef]);
  return {
    calledFor,
    pointerMovedTo,
    menuOfHandleShut,
  };
}
export function TableHandle({
  grid: { handlesOfTables, body, rowsDrawn },
  calledFor,
  isMenuOpen,
}: TableHandleProps) {
  let called = handlesOfTables.find(({ table }) => table.key === calledFor);
  let isMotionReduced = useReducedMotion();
  let [shownBefore, setShown] = React.useState<TableHandlesShown>({
    called: null,
    going: null,
  });
  let shown = tableHandlesShownNext(shownBefore, called?.table.key ?? null, isMotionReduced);
  if (shown !== shownBefore) setShown(shown);
  let goingEnded = React.useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName === 'opacity' && event.currentTarget.hasAttribute('data-is-going')) setShown(withoutTableHandleGoing);
    },
    [setShown],
  );
  React.useEffect(() => {
    if (shown.going === null) return;
    let timer = setTimeout(() => setShown(withoutTableHandleGoing), TABLE_HANDLE_GOING_MS);
    return () => clearTimeout(timer);
  }, [shown.going]);
  let going = handlesOfTables.find(
    ({ table, rowNumberUnder }) => table.key === shown.going && rowNumberUnder === null,
  );
  return <>{handlesOfTables
      .filter((handle) => handle === called || handle === going)
      .map(
        (handle) =>
          (<div key={handle.table.key} aria-hidden className="sheet-handle-of-table" data-is-beside-header-kept={handle.isBesideHeaderKept || undefined} data-is-going={handle === called ? undefined : ''} onTransitionEnd={goingEnded} data-is-over-row-number={!handle.isOverRowNumbers
                ? undefined
                : rowsDrawn.some((row) => row.isActive && row.rowNumber === handle.table.area.topRowIndex + 1)
                  ? 'active'
                  : 'plain'} data-is-menu-open={isMenuOpen && handle === called ? '' : undefined} {...(handle === called && {
                [TABLE_OF_HANDLE_ATTRIBUTE]: handle.table.key,
              })} style={{
                left: body.left + handle.left,
                top: body.top + handle.top,
                width: handle.width,
                height: handle.height,
              }} />),
      )}</>;
}
export const TABLE_HANDLE_GOING_MS = 500;
export const TABLE_OF_HANDLE_ATTRIBUTE = 'data-table-of-handle';
export const tableKeyOfHandleAt = (target: EventTarget | null): string | undefined =>
  (target instanceof Element ? target.closest(`[${TABLE_OF_HANDLE_ATTRIBUTE}]`) : null)?.getAttribute(TABLE_OF_HANDLE_ATTRIBUTE) ?? undefined;
export const isAtTableHandleOverRowNumber = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`[${TABLE_OF_HANDLE_ATTRIBUTE}][data-is-over-row-number]`) !== null;
export const rowNumberUnderTableHandle = (
  { handlesOfTables, cellsHeld }: GridWithHandleRowNumbers,
  tableKey: string | null,
): number | null =>
  handlesOfTables.find(({ table }) => table.key === tableKey)?.rowNumberUnder ?? cellsHeld?.handle?.rowNumberUnder ?? null;
export const tableHandlesShownNext = (shown: TableHandlesShown, called: string | null, isMotionReduced: boolean): TableHandlesShown => {
  if (called === shown.called) return shown;
  if (isMotionReduced)
    return {
      called,
      going: null,
    };
  let leaving = shown.called ?? shown.going;
  return {
    called,
    going: leaving === called ? null : leaving,
  };
};
export const withoutTableHandleGoing = (shown: TableHandlesShown): TableHandlesShown =>
  shown.going === null
    ? shown
    : {
        ...shown,
        going: null,
      };
