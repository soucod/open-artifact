import * as React from 'react';
import { pointInZoomedElement } from '../grid/zoom.ts';
import { NO_FLAGS_HIDDEN, type FlagsAtPointer, type FlagsOfGrid } from './flags-at-pointer.ts';
import type { SheetController } from '../state/controller.ts';
/** Where the pointer is on the page. */
export type PointerAt = Pick<MouseEvent, 'clientX' | 'clientY'>;
export interface NameFlagsAtPointerDeps {
  store: Pick<SheetController, 'nameFlagsByPointer'>;
  drawn: Pick<FlagsOfGrid, 'nameFlagsOfOthers' | 'marksOnChangesByAgent'>;
  gridRef: React.RefObject<Element | null>;
  zoom: number;
}
export interface NameFlagsAtPointer extends FlagsAtPointer {
  pointerMovedTo(pointer: PointerAt | null): void;
}
export function useNameFlagsAtPointer({ store, drawn, gridRef, zoom }: NameFlagsAtPointerDeps): NameFlagsAtPointer {
  let pointerRef = React.useRef<PointerAt | null>(null);
  let [flagsAtPointer, setFlagsAtPointer] = React.useState<FlagsAtPointer>(NO_NAME_FLAGS_AT_POINTER);
  let hasFlagsOrMarks = drawn.nameFlagsOfOthers.length + drawn.marksOnChangesByAgent.length > 0;
  let lookAtPointer = React.useCallback(() => {
    let [pointer, grid] = [pointerRef.current, gridRef.current];
    let flagsNow =
      pointer === null || grid === null || !hasFlagsOrMarks
        ? NO_NAME_FLAGS_AT_POINTER
        : store.nameFlagsByPointer(pointInZoomedElement(grid, zoom, pointer));
    setFlagsAtPointer((flagsBefore) => (JSON.stringify(flagsBefore) === JSON.stringify(flagsNow) ? flagsBefore : flagsNow));
  }, [store, gridRef, zoom, hasFlagsOrMarks]);
  React.useLayoutEffect(lookAtPointer, [lookAtPointer, drawn]);
  let pointerMovedTo = React.useCallback(
    (pointerEvent: PointerAt | null) => {
      pointerRef.current =
        pointerEvent === null
          ? null
          : {
              clientX: pointerEvent.clientX,
              clientY: pointerEvent.clientY,
            };
      lookAtPointer();
    },
    [lookAtPointer],
  );
  return {
    ...flagsAtPointer,
    pointerMovedTo,
  };
}
export const NO_NAME_FLAGS_AT_POINTER: FlagsAtPointer = {

  cornerOnTop: null,
  cornersCalledUp: [],
  flagsHidden: NO_FLAGS_HIDDEN,
};
