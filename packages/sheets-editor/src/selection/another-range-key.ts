import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
export function watchAnotherRangeKey(ownWindow: Window): () => void {
  let documentElement = ownWindow.document.documentElement;
  let controller = new AbortController();
  let listenerOptions = {
    signal: controller.signal,
    capture: true,
  };
  let onPointerMove = ({ metaKey, ctrlKey }: PointerEvent) => {
    documentElement.toggleAttribute(MAKES_ROOM_FOR_ANOTHER_RANGE_ATTRIBUTE, metaKey || (ctrlKey && !IS_APPLE_PLATFORM));
  };
  ownWindow.addEventListener('pointermove', onPointerMove, listenerOptions);
  ownWindow.addEventListener(
    'keyup',
    ({ key }: KeyboardEvent) => {
      if (key === 'Meta' || key === 'Control') documentElement.removeAttribute(MAKES_ROOM_FOR_ANOTHER_RANGE_ATTRIBUTE);
    },
    listenerOptions,
  );
  ownWindow.addEventListener('blur', () => documentElement.removeAttribute(MAKES_ROOM_FOR_ANOTHER_RANGE_ATTRIBUTE), listenerOptions);
  return () => {
    controller.abort();
    documentElement.removeAttribute(MAKES_ROOM_FOR_ANOTHER_RANGE_ATTRIBUTE);
  };
}
export const MAKES_ROOM_FOR_ANOTHER_RANGE_ATTRIBUTE = 'data-makes-room-for-another-range';
