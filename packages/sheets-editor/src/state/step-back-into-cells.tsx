import type { SheetController } from './controller.ts';
import * as React from 'react';
import { doesKeyStepBackIntoCells } from './escape.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { cellsInSightText } from '../i18n/notice-labels.ts';
import { DEFAULT_ROW_HEIGHT } from '../grid/cell-metrics-values.ts';
export function useStepBackIntoCells({ store, gridRef, isSteppedOut }: StepBackIntoCellsProps): void {
  React.useLayoutEffect(() => {
    let grid = gridRef.current;
    if (grid === null || !isSteppedOut) return;
    let ownerDocument = grid.ownerDocument;
    let stepBack = () =>
      store.dispatch({
        kind: 'steppedBackIntoCells',
      });
    let onKeyDown = ({ key }: KeyboardEvent) => {
      if (doesKeyStepBackIntoCells(key)) stepBack();
    };
    ownerDocument.addEventListener('keydown', onKeyDown, true);
    ownerDocument.addEventListener('pointerdown', stepBack, true);
    ownerDocument.addEventListener('paste', stepBack, true);
    grid.addEventListener('blur', stepBack);
    return () => {
      ownerDocument.removeEventListener('keydown', onKeyDown, true);
      ownerDocument.removeEventListener('pointerdown', stepBack, true);
      ownerDocument.removeEventListener('paste', stepBack, true);
      grid.removeEventListener('blur', stepBack);
    };
  }, [store, gridRef, isSteppedOut]);
}
export function ReadersScroller(props: ReadersScrollerProps) {
  let { store, isOn } = props;
  let { scroll, pagesTurnedForReader: pagesTurned } = props.grid;
  let scrollerRef = React.useRef<HTMLDivElement>(null);
  let restingPlace = React.useRef({
    top: 0,
    left: 0,
    pagesTurned,
  });
  let settle = React.useRef(() => {});
  let settleTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let [top, left] = [readerScrollPlaceOf(scroll.rows), readerScrollPlaceOf(scroll.columns)];
  let [roomDown, roomAcross] = [readerScrollRoomOf(scroll.rows), readerScrollRoomOf(scroll.columns)];
  let waitToSettle = React.useCallback(() => {
    if (scrollerRef.current?.hasAttribute(READERS_SCROLLER_NO_ROOM_ATTR) === false)
      scrollerRef.current.setAttribute(READERS_SCROLLER_NO_ROOM_ATTR, '');
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => settle.current(), READER_SCROLL_SETTLE_MS);
  }, []);
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    settle.current = () => {
      clearTimeout(settleTimer.current);
      scroller.removeAttribute(READERS_SCROLLER_NO_ROOM_ATTR);
      scroller.scrollTo({
        top: Math.min(top, roomDown),
        left: Math.min(left, roomAcross),
        behavior: 'instant',
      });
      restingPlace.current = {
        top: scroller.scrollTop,
        left: scroller.scrollLeft,
        pagesTurned,
      };
    };
    if (restingPlace.current.pagesTurned === pagesTurned) waitToSettle();
    else settle.current();
  }, [top, left, pagesTurned, roomDown, roomAcross, waitToSettle]);
  React.useEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    let onScroll = () => {
      if (scroller.hasAttribute(READERS_SCROLLER_NO_ROOM_ATTR)) return;
      let { rows, columns } = store.getView().grid.scroll;
      let deltaY = readerScrollTurn(scroller.scrollTop - restingPlace.current.top, rows, READER_SCROLL_STEP.rows);
      let deltaX = readerScrollTurn(scroller.scrollLeft - restingPlace.current.left, columns, READER_SCROLL_STEP.columns);
      if (deltaX === 0 && deltaY === 0) return;
      scroller.scrollTo({
        top: restingPlace.current.top,
        left: restingPlace.current.left,
        behavior: 'instant',
      });
      store.dispatch({
        kind: 'wheelTurned',
        deltaX,
        deltaY,
        isPageForReader: true,
      });
    };
    scroller.addEventListener('scroll', onScroll, {
      passive: true,
    });
    for (let kind of READER_TOUCH_EVENTS) document.addEventListener(kind, waitToSettle, READER_TOUCH_LISTENER_OPTIONS);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      for (let kind of READER_TOUCH_EVENTS) document.removeEventListener(kind, waitToSettle, READER_TOUCH_LISTENER_OPTIONS);
    };
  }, [store, waitToSettle]);
  React.useEffect(() => () => clearTimeout(settleTimer.current), []);
  if (!isOn)
    return <>{props.children}</>;
  return <div ref={scrollerRef} role="presentation" className="sheet-readers-scroller"><div aria-hidden style={{
          width: `calc(100% + ${roomAcross}px)`,
          height: `calc(100% + ${roomDown}px)`,
        }} />{props.children}</div>;
}
export function rowsAndColumnsInSight(grid: Pick<GridForReader, 'rowsDrawn' | 'columnHeaders' | 'scroll'>): CellsInSight | null {
  let { rowsDrawn, columnHeaders, scroll } = grid;
  let rowsInSight = rowsDrawn.filter(
    ({ isBehindBars, top, height }) =>
      !isBehindBars && top + height > scroll.rows.from && top < scroll.rows.to,
  );
  let columnsInSight = columnHeaders.filter(
    ({ left, width }) => left + width > scroll.columns.from && left < scroll.columns.to,
  );
  let [firstRow, lastRow] = [rowsInSight[0], rowsInSight.at(-1)];
  let [firstColumn, lastColumn] = [columnsInSight[0], columnsInSight.at(-1)];
  if (firstRow === undefined || lastRow === undefined || firstColumn === undefined || lastColumn === undefined) return null;
  return {
    rows: [firstRow.headerText, lastRow.headerText],
    columns: [firstColumn.text, lastColumn.text],
  };
}
export function ReaderPageAnnouncer({ grid }: { grid: GridForReader }) {
  let [said, setSaid] = React.useState<SaidOfReaderPage>({
    pagesTurned: grid.pagesTurnedForReader,
    inSight: null,
  });
  if (said.pagesTurned !== grid.pagesTurnedForReader)
    setSaid({
      pagesTurned: grid.pagesTurnedForReader,
      inSight: rowsAndColumnsInSight(grid),
    });
  return <LiveAnnouncer words={said.inSight !== null && cellsInSightText(said.inSight.rows, said.inSight.columns)} timesSaid={said.pagesTurned} />;
}
export const READER_SCROLL_STEP = {
  rows: DEFAULT_ROW_HEIGHT,
  columns: 60,
};
export const MOST_READER_SCROLL_ROOM = 8e6;
export const LEAST_READER_SCROLL_MOVE = 2;
export const READER_SCROLL_SETTLE_MS = 200;
export const readerScrollRoomOf = ({ most }: Pick<ReaderScrollAxis, 'most'>): number => Math.max(0, Math.min(most, MOST_READER_SCROLL_ROOM));
export const readerScrollPlaceOf = (axis: Pick<ReaderScrollAxis, 'by' | 'most'>): number => {
  let by = Math.min(axis.by, axis.most);
  return Math.round(axis.most <= MOST_READER_SCROLL_ROOM ? by : (by / axis.most) * MOST_READER_SCROLL_ROOM);
};
export const readerScrollTurn = (moved: number, { room }: Pick<ReaderScrollAxis, 'room'>, step: number): number =>
  Math.abs(moved) < LEAST_READER_SCROLL_MOVE ? 0 : Math.sign(moved) * Math.max(room / 2, room - step, DEFAULT_ROW_HEIGHT);
export const READERS_SCROLLER_NO_ROOM_ATTR = 'data-has-no-room';
export const READER_TOUCH_EVENTS = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
export const READER_TOUCH_LISTENER_OPTIONS: AddEventListenerOptions = {
  passive: true,
  capture: true,
};
export interface StepBackIntoCellsProps {
  store: Pick<SheetController, 'dispatch'>;
  gridRef: React.RefObject<HTMLElement | null>;
  isSteppedOut: boolean;
}
/** Of one axis of the grid's scroll as drawn, what the reader's scroller reads: how far it is scrolled, how far it can be, and the room shown. */
export interface ReaderScrollAxis {
  by: number;
  most: number;
  from: number;
  to: number;
  room: number;
}
/** Of a drawn row of the grid, what is read here to tell the rows in sight. */
export interface RowOfReader {
  isBehindBars: boolean;
  top: number;
  height: number;
  headerText: string;
}
/** Of a drawn column header of the grid, what is read here to tell the columns in sight. */
export interface ColumnOfReader {
  left: number;
  width: number;
  text: string;
}
/** Of the grid as drawn, what a screen reader's scroller and its announcer read. */
export interface GridForReader {
  scroll: { rows: ReaderScrollAxis; columns: ReaderScrollAxis };
  pagesTurnedForReader: number;
  rowsDrawn: readonly RowOfReader[];
  columnHeaders: readonly ColumnOfReader[];
}
export interface ReadersScrollerProps {
  store: Pick<SheetController, 'dispatch' | 'getView'>;
  grid: GridForReader;
  isOn: boolean;
  children?: React.ReactNode;
}
/** The first and last rows and columns in sight, by their headers. */
export interface CellsInSight {
  rows: [string, string];
  columns: [string, string];
}
interface SaidOfReaderPage {
  pagesTurned: number;
  inSight: CellsInSight | null;
}
