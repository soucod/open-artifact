import type { SheetId } from '@open-artifact/sheets-core';
import type { SheetController } from '../state/controller.ts';
import type { PlaceOfLink, SheetLinks } from '../shell/sheet-links.ts';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
export function listenForCopySheetLinkShortcut(
  target: Window,
  copySheetLink: () => void,
  isApplePlatform: boolean = IS_APPLE_PLATFORM,
): () => void {
  let onKeyDown = (event: KeyboardEvent) => {
    if (!isCopySheetLinkShortcut(event, isApplePlatform)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) copySheetLink();
  };
  target.addEventListener('keydown', onKeyDown, true);
  return () => target.removeEventListener('keydown', onKeyDown, true);
}
/** Shows the sheet a link names and lights its cells; false when the page has no such sheet. */
export function goToPlace(store: Pick<SheetController, 'getView' | 'dispatch'>, place: PlaceOfLink): boolean {
  let { sheetId } = place;
  if (!store.getView().listedSheets.some((sheet) => sheet.sheetId === sheetId)) return false;
  store.dispatch({
    kind: 'sheetNameLeft',
  });
  store.dispatch({
    kind: 'entryLeft',
  });
  store.dispatch({
    kind: 'sheetChosen',
    sheetId,
    canPoint: false,
  });
  if (place.ranges.length > 0)
    store.dispatch({
      kind: 'cellsLinkedTo',
      place,
    });
  return true;
}
export function syncShownSheetWithLinks(
  sheetLinks: SheetLinks,
  store: Pick<SheetController, 'subscribe' | 'getView' | 'dispatch'>,
  isEarlierVersionShown: boolean = false,
): () => void {
  let sheetIdShown: SheetId | null = null;
  let lastSheetPointedIn: SheetId | null = null;
  let unsubscribe = store.subscribe(() => {
    let { lastDone, listedSheets, sheetPointedIn } = store.getView();
    let sheetPointedBefore = lastSheetPointedIn;
    lastSheetPointedIn = sheetPointedIn;
    let sheetToShow =
      listedSheets.find(({ holdsOpenEntry }) => holdsOpenEntry) ??
      listedSheets.find(({ isShown }) => isShown);
    if (sheetToShow === undefined || sheetToShow.sheetId === sheetIdShown) return;
    let sheetShownBefore = sheetIdShown;
    sheetIdShown = sheetToShow.sheetId;
    let isFromSheetChange =
      ((lastDone?.what === 'sheetShown' && lastDone.name === sheetToShow.name) || sheetToShow.sheetId === sheetPointedBefore) &&
      listedSheets.some((sheet) => sheet.sheetId === sheetShownBefore);
    sheetLinks.sheetOnShowIs(sheetToShow.sheetId, isFromSheetChange);
  });
  sheetLinks.onPlaceAskedFor((place) => goToPlace(store, place) && !isEarlierVersionShown);
  return () => {
    sheetLinks.onPlaceAskedFor(null);
    unsubscribe();
  };
}
export const isCopySheetLinkShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  event.altKey &&
  !event.shiftKey &&
  (isMac ? event.metaKey && !event.ctrlKey && event.code === 'KeyL' : event.ctrlKey && !event.metaKey && (event.key === 'l' || event.key === 'L'));
