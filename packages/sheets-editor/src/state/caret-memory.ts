import type { PressesHeardAtStart } from '../app/sheet-page.tsx';
/** Finds the storage of this tab, which may throw where storage is blocked. */
export type StorageOf = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export function takeStoredCaretPlace(storageOf: StorageOf, pageStartMs: number, wallNowMs: number): StoredCaretPlace | null {
  try {
    let storage = storageOf();
    let raw = storage.getItem('sheets-caret');
    storage.removeItem('sheets-caret');
    if (raw === null) return null;
    let stored: unknown = JSON.parse(raw);
    if (!isPlainObjectValue(stored)) return 'outsideCells';
    let { isInCells, isInEntry, leftAtMs, leftAtWallMs } = stored;
    let placeIfLeft: StoredCaretPlace = isInEntry === true ? 'inEntry' : 'outsideCells';
    if (isInCells === false && typeof leftAtWallMs === 'number') return leftAtWallMs + 1000 < wallNowMs ? null : placeIfLeft;
    if (isInCells === false) return placeIfLeft;
    if (isInCells !== true) return 'outsideCells';
    if (leftAtMs === undefined) return 'inCells';
    if (typeof leftAtMs !== 'number') return 'outsideCells';
    return leftAtMs >= pageStartMs ? 'inCells' : null;
  } catch {
    return 'outsideCells';
  }
}
export function forgetStoredCaretPlace(storageOf: StorageOf): void {
  try {
    storageOf().removeItem('sheets-caret');
  } catch {}
}
export function keepCaretPlaceStored(storageOf: StorageOf, afterEvents: (run: () => void) => void, page: PageOfCaret): () => void {
  let isStopped: boolean = false;
  let isInCells: boolean | null = null;
  let isInEntry: boolean = false;
  let storedWithoutLeaving: string | null = null;
  let keptBy = Math.random();
  let store = (leftAt?: CaretLeftAt) => {
    if (isInCells === null) return;
    let stored = JSON.stringify({
      isInCells,
      isInEntry,
      ...leftAt,
      keptBy,
    });
    storedWithoutLeaving = leftAt === undefined ? stored : null;
    try {
      storageOf().setItem('sheets-caret', stored);
    } catch {}
  };
  let isStillStored = (stored: string) => {
    try {
      return storageOf().getItem('sheets-caret') === stored;
    } catch {
      return false;
    }
  };
  let storeLeaving = () =>
    store({
      leftAtMs: page.nowMs(),
      leftAtWallMs: page.wallNowMs(),
    });
  let update = () => {
    let isInCellsNow = isStopped ? null : page.isInCells();
    if (isInCellsNow === null) return;
    isInCells = isInCellsNow;
    isInEntry = page.isInEntry();
    store();
  };
  let unsubscribers = [
    page.onMoved((isSettled) => (isSettled ? update() : afterEvents(update))),
    page.onLeftPage(storeLeaving),
    page.onPageEnds(() => {
      if (isInCells === false && storedWithoutLeaving !== null && isStillStored(storedWithoutLeaving)) storeLeaving();
    }),
    page.onCameBackToPage(() => afterEvents(() => (isInCells === null ? undefined : update()))),
    page.onEntryOpenedOrEnded(() => afterEvents(() => (isInCells === null ? undefined : update()))),
  ];
  return () => {
    isStopped = true;
    for (let unsubscribe of unsubscribers) unsubscribe();
  };
}
export const isPlainObjectValue = (candidate: unknown): candidate is Partial<Record<string, unknown>> => typeof candidate === 'object' && candidate !== null;
export const doCellsTakeCaretAtStart = (storedPlace: CaretAtStart | null, haveActsCome: boolean): boolean =>
  storedPlace === 'inSpreadsheetTakenOff' || storedPlace === 'inCells' || storedPlace === 'inEntry' || (storedPlace === null && !haveActsCome);
/** How soon after the page starts a keyboard may still be handed over to the cells. */
export const KEYBOARD_HANDED_OVER_WITHIN_MS = 1e4;
/** Whether the page took the keyboard from the page it was opened from: a place was kept, and nothing was pressed or left since. */
export const isKeyboardHandedOverAtStart = (
  storedPlace: CaretAtStart | null,
  hasKeyboard: boolean,
  msSinceStart: number,
  pressesHeard: PressesHeardAtStart,
): boolean =>
  hasKeyboard &&
  storedPlace !== null &&
  msSinceStart < KEYBOARD_HANDED_OVER_WITHIN_MS &&
  pressesHeard.pressesBegun === 0 &&
  pressesHeard.timesFocusLeft === 0;
export const shouldFocusEntryAtStart = (storedPlace: CaretAtStart | null, haveActsCome: boolean, isFirstEntryOpen: boolean): boolean =>
  storedPlace !== 'inSpreadsheetTakenOff' && (haveActsCome || (storedPlace === 'inEntry' && !isFirstEntryOpen));
export const CARET_ARROW_KEY_PATTERN = /^Arrow(?:Up|Down|Left|Right)$/;
export const CARET_TAB_OR_F6_PATTERN = /^(?:Tab|F6)$/;
export const isKeyForCellsAtStart = (
  storedPlace: CaretAtStart | null,
  keyEvent: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  isFirstEntryOpen: boolean,
): boolean =>
  storedPlace !== 'inEntry' ||
  isFirstEntryOpen ||
  (!(keyEvent.altKey || keyEvent.ctrlKey || keyEvent.metaKey) &&
    (CARET_TAB_OR_F6_PATTERN.test(keyEvent.key) || (CARET_ARROW_KEY_PATTERN.test(keyEvent.key) && !keyEvent.shiftKey)));
/** Where the caret was when this tab last left the spreadsheet: in the cells, in an entry, or elsewhere. */
export type StoredCaretPlace = 'inCells' | 'inEntry' | 'outsideCells';
/** Where the caret goes as the spreadsheet opens: as stored, or into the cells when the spreadsheet took it off a pane. */
export type CaretAtStart = StoredCaretPlace | 'inSpreadsheetTakenOff';
/** When the caret left the page, by the page's clock and the wall clock. */
export interface CaretLeftAt {
  leftAtMs: number;
  leftAtWallMs: number;
}
/** What the page tells of where its caret is, and when that changes. Each `on…` returns a way to stop listening. */
export interface PageOfCaret {
  isInCells(): boolean | null;
  isInEntry(): boolean;
  onMoved(listener: (isSettled: boolean) => void): () => void;
  onLeftPage(listener: () => void): () => void;
  onPageEnds(listener: () => void): () => void;
  onCameBackToPage(listener: () => void): () => void;
  onEntryOpenedOrEnded(listener: () => void): () => void;
  nowMs(): number;
  wallNowMs(): number;
}
