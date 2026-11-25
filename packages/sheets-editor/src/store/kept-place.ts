import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ScrollForLessRoom, SavedPlace } from '../state/initial-state.ts';
import type { SheetController } from '../state/controller.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import { MAX_UNPAINTED_OPENS_OF_KEPT_FILTERS } from '../tables/kept-own-filters.ts';
import { savedPlaceForLinkedSheet } from '../links/sheet-links.ts';
import { isSameCell } from '../selection/model.ts';

/** Where the place is kept: the tab's storage, the browser's, and whose page this is. */
export interface KeptPlaceStorages {
  findTabs(): Storage;
  findBrowsers(): Storage;
  viewer(): string | null;
}

/** The cell an earlier version opened on, and whether the workbook still has a cell. */
export interface CellOpened {
  cellOpenedFor: CellId | null;
  has(cell: CellId): boolean;
}

export function parseKeptPlaceCell(kept: unknown, sheetId: SheetId): CellId | null {
  if (!isPlaceRecord(kept) || kept.sheetId !== sheetId) return null;
  let { rowId, columnId } = kept;
  return typeof rowId === 'string' && typeof columnId === 'string'
    ? {
        sheetId,
        rowId,
        columnId,
      }
    : null;
}
export function parseScrollForLessRoom(kept: unknown): ScrollForLessRoom | null {
  if (!isPlaceRecord(kept)) return null;
  let { from, end, at } = kept;
  return typeof from === 'number' && typeof end === 'number' && typeof at === 'number'
    ? {
        from,
        end,
        at,
      }
    : null;
}
export function parseKeptPlace(kept: unknown): SavedPlace | null {
  if (!isPlaceRecord(kept)) return null;
  let { sheetId, scrollLeft, scrollTop } = kept;
  if (typeof sheetId !== 'string' || typeof scrollLeft !== 'number' || typeof scrollTop !== 'number') return null;
  let activeCell = parseKeptPlaceCell(kept.activeCell, sheetId);
  let selectionCorner = parseKeptPlaceCell(kept.selectionCorner, sheetId);
  let lines = typeof kept.lines === 'string' ? kept.lines : null;
  let density: CellDensity = kept.density === 'comfortable' ? 'comfortable' : 'compact';
  let keptScrollForLessRoom = kept.scrolledForLessRoom;
  let scrolledForLessRoom = isPlaceRecord(keptScrollForLessRoom)
    ? {
        sheetId,
        across: parseScrollForLessRoom(keptScrollForLessRoom.across),
        down: parseScrollForLessRoom(keptScrollForLessRoom.down),
      }
    : null;
  return activeCell === null || selectionCorner === null
    ? null
    : {
        sheetId,
        activeCell,
        selectionCorner,
        scrollLeft,
        scrollTop,
        lines,
        density,
        scrolledForLessRoom,
      };
}
export function tryOrNull<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
export function takeSheetLastOpenedByViewer(storages: KeptPlaceStorages): SheetId | null {
  let viewer = storages.viewer();
  if (viewer === null) return null;
  let browserStorage = storages.findBrowsers();
  let json = browserStorage.getItem(KEPT_PLACE_KEY);
  browserStorage.removeItem(KEPT_PLACE_KEY);
  let kept: unknown = json === null ? null : JSON.parse(json);
  if (!isPlaceRecord(kept) || kept.viewer !== viewer) return null;
  let { sheetId, openedUnpainted } = kept;
  if (typeof sheetId !== 'string' || typeof openedUnpainted !== 'number') return null;
  if (!(openedUnpainted >= 0 && openedUnpainted < MAX_UNPAINTED_OPENS_OF_KEPT_FILTERS)) return null;
  return (
    browserStorage.setItem(
      KEPT_PLACE_KEY,
      JSON.stringify({
        viewer,
        openedUnpainted: openedUnpainted + 1,
        sheetId,
      }),
    ),
    sheetId
  );
}
export function resetTabPlace({ findTabs }: Pick<KeptPlaceStorages, 'findTabs'>): void {
  tryOrNull(() => findTabs().removeItem(KEPT_PLACE_KEY));
  tryOrNull(() => findTabs().setItem(KEPT_PLACE_KEY, NO_KEPT_PLACE));
}
export function takePlaceToOpenOn(
  storages: KeptPlaceStorages,
  reads: WorkbookReads,
  sheetOfNewLink: SheetId | null,
  isEarlierVersionShown: boolean = false,
): { toOpenOn: SavedPlace | null; isTabsOwn: boolean } {
  let json = tryOrNull(() => storages.findTabs().getItem(KEPT_PLACE_KEY));
  if (!isEarlierVersionShown) resetTabPlace(storages);
  let tabsPlace = json === null ? null : tryOrNull(() => parseKeptPlace(JSON.parse(json)));
  let sheetToOpen = sheetOfNewLink ?? (json === null ? tryOrNull(() => takeSheetLastOpenedByViewer(storages)) : null);
  let toOpenOn: SavedPlace | null = savedPlaceForLinkedSheet(reads, sheetToOpen, tabsPlace);
  return {
    toOpenOn,
    isTabsOwn: tabsPlace !== null && toOpenOn === tabsPlace,
  };
}
export function forgetKeptPlace(storages: KeptPlaceStorages): void {
  resetTabPlace(storages);
  if (storages.viewer() !== null) tryOrNull(() => storages.findBrowsers().removeItem(KEPT_PLACE_KEY));
}
export function keepPlaceAcrossReloads(
  storages: KeptPlaceStorages,
  store: Pick<SheetController, 'place' | 'subscribe'>,
  after: (run: () => void) => void,
  isTabsOwn: boolean,
  cellOpened: CellOpened | null = null,
): () => void {
  let viewer = storages.viewer();
  let skipsSheetNote: boolean = isTabsOwn;
  let noteSheetForViewer = (sheetId: SheetId): void => {
    if (viewer === null || storages.viewer() !== viewer) return;
    let json = JSON.stringify({
      viewer,
      openedUnpainted: 0,
      sheetId,
    });
    if (tryOrNull(() => storages.findBrowsers().getItem(KEPT_PLACE_KEY)) === json) return;
    tryOrNull(() => storages.findBrowsers().removeItem(KEPT_PLACE_KEY));
    tryOrNull(() => storages.findBrowsers().setItem(KEPT_PLACE_KEY, json));
  };
  let lastWritten: string | null = null;
  let cellOpenedFor: CellId | null = cellOpened?.cellOpenedFor ?? null;
  let isOpenedCellGone: boolean = false;
  let isWritePending: boolean = false;
  let isStopped: boolean = false;
  let placeJsonIfChanged = (): string | null => {
    let place = store.place();
    let placeJson = place === null ? null : JSON.stringify(place);
    return placeJson === lastWritten ? null : placeJson;
  };
  let unsubscribe = store.subscribe(() => {
    if (isWritePending || placeJsonIfChanged() === null) return;
    isWritePending = true;
    after(() => {
      isWritePending = false;
      let placeJson = isStopped ? null : placeJsonIfChanged();
      if (placeJson === null) return;
      lastWritten = placeJson;
      let place = store.place();
      if (place === null || cellOpenedFor === null || !isSameCell(place.activeCell, cellOpenedFor))
        isOpenedCellGone = cellOpened !== null && cellOpenedFor !== null && !cellOpened.has(cellOpenedFor);
      cellOpenedFor = place?.activeCell ?? null;
      if (!isOpenedCellGone) {
        tryOrNull(() => storages.findTabs().setItem(KEPT_PLACE_KEY, placeJson));
        if (place !== null && !skipsSheetNote) noteSheetForViewer(place.sheetId);
      }
      skipsSheetNote = false;
    });
  });
  return () => {
    isStopped = true;
    unsubscribe();
  };
}
export const KEPT_PLACE_KEY = 'sheets-place';
export const NO_KEPT_PLACE = 'null';
export const isPlaceRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
