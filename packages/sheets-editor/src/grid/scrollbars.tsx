import * as React from 'react';
import { unzoomLength } from './zoom.ts';
import {
  OVERLAY_SCROLLBAR_INSET_PX,
  OVERLAY_SCROLLBAR_MIN_THUMB_PX,
  useOverlayScrollbarVisibility,
  OVERLAY_SCROLLBAR_WIDTH_PX,
  OverlayScrollbarThumb,
  thumbDragToScroll,
} from '../ui/overlay-scrollbar.tsx';
import type { LinesAxisName } from './geometry.ts';
import type { GridOfPage } from '../view/page-view.ts';
import type { SheetController } from '../state/controller.ts';
/** How the cells are scrolled along one axis: how far, how far they can go, and the stretch of the grid that scrolls. */
export interface ScrollAlongAxis {
  by: number;
  most: number;
  from: number;
  to: number;
  room: number;
}
/** Where a scrollbar's thumb is along its track, how long it is, and how far it can travel. */
export interface ScrollbarThumb {
  start: number;
  length: number;
  way: number;
}
export interface GridScrollbarsProps {
  grid: Pick<GridOfPage, 'body' | 'scroll' | 'isMoreToTheRight'>;
  store: Pick<SheetController, 'getView' | 'dispatch'>;
  zoom: number;
}
export function gridScrollbarThumb({ by, most, from, to, room }: ScrollAlongAxis, zoom: number = 1): ScrollbarThumb | null {
  let track = to - from - unzoomLength(OVERLAY_SCROLLBAR_INSET_PX + GRID_SCROLLBAR_ROOM_PX, zoom);
  let minThumbLength = unzoomLength(OVERLAY_SCROLLBAR_MIN_THUMB_PX, zoom);
  if (most <= 0 || track <= minThumbLength) return null;
  let thumbLength = Math.max(minThumbLength, Math.round((track * room) / (most + room)));
  let way = track - thumbLength;
  return {
    start: from + unzoomLength(OVERLAY_SCROLLBAR_INSET_PX, zoom) + Math.round((way * Math.min(by, most)) / most),
    length: thumbLength,
    way,
  };
}
export function GridScrollbars({
  grid: { body, scroll, isMoreToTheRight },
  store,
  zoom,
}: GridScrollbarsProps) {
  let layerRef = React.useRef<HTMLDivElement>(null);
  let { areShown, moved: showMoved, held: hold } = useOverlayScrollbarVisibility(layerRef);
  let byAtHoldRef = React.useRef(0);
  let { by: rowsBy } = scroll.rows;
  let { by: columnsBy } = scroll.columns;
  let lastScrollRef = React.useRef({
    down: rowsBy,
    right: columnsBy,
  });
  React.useEffect(() => {
    if (lastScrollRef.current.down !== rowsBy || lastScrollRef.current.right !== columnsBy) showMoved();
    lastScrollRef.current = {
      down: rowsBy,
      right: columnsBy,
    };
  }, [rowsBy, columnsBy, showMoved]);
  let scrollbarAlong = (axis: LinesAxisName) => {
    let scrollOfAxis = scroll[axis];
    let thumb = gridScrollbarThumb(scrollOfAxis, zoom);
    if (thumb === null) return null;
    let [width, inset] = [OVERLAY_SCROLLBAR_WIDTH_PX, OVERLAY_SCROLLBAR_INSET_PX].map(
      (pixels: number) => unzoomLength(pixels, zoom),
    );
    return <OverlayScrollbarThumb along={axis === 'rows' ? 'y' : 'x'} isShown={areShown || (axis === 'columns' && isMoreToTheRight)} isForFingersToo={false} style={axis === 'rows'
          ? {
              width,
              right: inset,
              top: body.top + thumb.start,
              height: thumb.length,
            }
          : {
              height: width,
              bottom: inset,
              left: body.left + thumb.start,
              width: thumb.length,
            }} onHeld={(isHeld: boolean) => {
        byAtHoldRef.current = scrollOfAxis.by;
        hold(isHeld);
      }} onDragged={(dragged: number) => {
        let delta =
          scrollForThumbDrag(unzoomLength(dragged, zoom), byAtHoldRef.current, scrollOfAxis.most, thumb) - store.getView().grid.scroll[axis].by;
        store.dispatch({
          kind: 'wheelTurned',
          deltaX: axis === 'columns' ? delta : 0,
          deltaY: axis === 'rows' ? delta : 0,
        });
      }} />;
  };
  return <div ref={layerRef} aria-hidden className="pointer-events-none absolute inset-0 z-7">{scrollbarAlong('rows')}{scrollbarAlong('columns')}</div>;
}
export const GRID_SCROLLBAR_ROOM_PX = OVERLAY_SCROLLBAR_WIDTH_PX + 2 * OVERLAY_SCROLLBAR_INSET_PX;
export const scrollForThumbDrag = (dragged: number, byAtHold: number, most: number, thumb: ScrollbarThumb): number =>
  byAtHold +
  thumbDragToScroll(
    dragged,
    {
      scrollHeight: most + thumb.way + thumb.length,
      clientHeight: thumb.way + thumb.length,
    },
    thumb.length,
  );
