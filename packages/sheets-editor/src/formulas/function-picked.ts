import * as ReactDOM from 'react-dom';
import { eventsToPickFunction } from './autocomplete.ts';
import type { SheetController } from '../state/controller.ts';
/**
 * Picks a function once the events before are done: lists every function, then chooses `functionName` in the list.
 * `onPicked` runs once the page shows the pick; nothing happens once `isStale` says the pick is no longer wanted.
 */
export function pickFunctionWhenSettled(
  functionName: string,
  store: SheetController,
  onPicked: () => void,
  isStale: () => boolean,
): void {
  store.onceEventsAreFinished(() => {
    if (isStale()) return;
    for (let event of eventsToPickFunction(functionName)) store.dispatch(event);
    store.lookOnceEventsAreFinished(() => {
      if (isStale()) return;
      ReactDOM.flushSync(() => {
        return;
      });
      onPicked();
    });
  });
}
