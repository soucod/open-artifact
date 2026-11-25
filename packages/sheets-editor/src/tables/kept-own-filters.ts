import type { Asked, ColumnOfATable, EngineCellTable, Filter, KindOfAColumn, RoleOfRows } from '@open-artifact/sheets-core';
import { ownFiltersToKeep } from './own-filter-actions.ts';
import type { OwnFilterToKeep } from './own-filter-actions.ts';
import type { FilterLine, FilterTerm } from './filter-model.ts';
import type { FilterTableInIds } from './own-filters.ts';
import type { KeptPlaceStorages } from '../store/kept-place.ts';
import type { SheetController } from '../state/controller.ts';
import type { KeptOwnFilter, SortKeyOfColumn } from '../state/event-reducer.ts';
/** Where own filters are kept: the tab's storage, the browser's, whose page this is, and the time on the wall. */
export interface KeptOwnFiltersStorages extends KeptPlaceStorages {
  wallNowMs(): number;
}
/** What is written to storage beside the viewer: the filters kept, and how often they opened unpainted. */
export interface KeptOwnFiltersWrite {
  tables?: readonly OwnFilterToKeep[];
  isOpeningWithSome?: boolean;
  keptAtMs?: number;
  openedUnpainted?: number;
}
/** An own filter read back from storage: its table always has a header. */
export interface KeptOwnFilterRead extends KeptOwnFilter {
  table: FilterTableInIds;
}
/** Own filters read back from storage, with the whole record they were written in. */
export interface KeptOwnFiltersRead {
  tables: KeptOwnFilterRead[];
  written: KeptRecord;
}
/** An object read back from storage, its fields not yet checked. */
type KeptRecord = Record<string, unknown>;
/** First and last rows of a span, as header and footer rows are kept. */
type RowSpanKept = EngineCellTable['headerRows'];
export function parseEveryKept<Parsed>(kept: unknown, parseOne: (keptItem: unknown) => Parsed | null): Parsed[] | null {
  if (!Array.isArray(kept)) return null;
  const parsed: Parsed[] = [];
  for (const keptItem of kept as readonly unknown[]) {
    const parsedItem = parseOne(keptItem);
    if (parsedItem === null) return null;
    parsed.push(parsedItem);
  }
  return parsed;
}
export function parseKeptRowSpan(kept: unknown): RowSpanKept | null {
  if (!isKeptFilterRecord(kept)) return null;
  const { firstRow, lastRow } = kept;
  return typeof firstRow === 'string' && typeof lastRow === 'string'
    ? {
        firstRow,
        lastRow,
      }
    : null;
}
export function parseKeptFilterTable(kept: unknown): FilterTableInIds | null {
  if (!isKeptFilterRecord(kept)) return null;
  const {
    sheetId,
    firstColumn,
    lastColumn,
    firstRowOfBody,
    lastRowOfBody,
    rowUnderTheBody,
  } = kept;
  const header = parseKeptRowSpan(kept.header);
  const isHeaderSure = isKeptFilterRecord(kept.header) ? kept.header.isSure : null;
  const runs = parseEveryKept(kept.runs, (keptRun) => {
    const rowSpan = parseKeptRowSpan(keptRun);
    const role = isKeptFilterRecord(keptRun) ? keptRun.role : null;
    return rowSpan !== null && isKeptRunRole(role)
      ? {
          ...rowSpan,
          role,
        }
      : null;
  });
  if (
    typeof sheetId !== 'string' ||
    typeof firstColumn !== 'string' ||
    typeof lastColumn !== 'string' ||
    typeof firstRowOfBody !== 'string' ||
    typeof lastRowOfBody !== 'string' ||
    (rowUnderTheBody !== null && typeof rowUnderTheBody !== 'string') ||
    header === null ||
    typeof isHeaderSure !== 'boolean' ||
    runs === null
  )
    return null;
  return {
    sheetId,
    header: {
      ...header,
      isSure: isHeaderSure,
    },
    firstColumn,
    lastColumn,
    firstRowOfBody,
    lastRowOfBody,
    rowUnderTheBody,
    runs,
  };
}
export function parseKeptFilterColumn(kept: unknown): ColumnOfATable | null {
  if (!isKeptFilterRecord(kept)) return null;
  const { c: columnId, name, kind } = kept;
  return typeof columnId === 'string' && (name === null || typeof name === 'string') && isKeptColumnKind(kind)
    ? {
        c: columnId,
        name,
        kind,
      }
    : null;
}
export function parseKeptFilterTerm(kept: unknown): FilterTerm | null {
  if (!isKeptFilterRecord(kept)) return null;
  const { c: columnId, asked } = kept;
  return typeof columnId === 'string' && isKeptFilterAsk(asked)
    ? {
        c: columnId,
        asked,
      }
    : null;
}
export function parseKeptAnyOf(kept: unknown): FilterLine | null {
  const [firstTerm, ...otherTerms] = parseEveryKept(isKeptFilterRecord(kept) ? kept.anyOf : null, parseKeptFilterTerm) ?? [];
  return firstTerm === undefined
    ? null
    : {
        anyOf: [firstTerm, ...otherTerms],
      };
}
export function parseKeptAllOf(kept: unknown): Filter | null {
  const [firstAnyOf, ...otherAnyOfs] = parseEveryKept(isKeptFilterRecord(kept) ? kept.allOf : null, parseKeptAnyOf) ?? [];
  return firstAnyOf === undefined
    ? null
    : {
        allOf: [firstAnyOf, ...otherAnyOfs],
      };
}
export function parseKeptSortBy(kept: unknown): SortKeyOfColumn[] | null {
  const [firstSort, ...otherSorts] =
    parseEveryKept(kept, (keptSort): SortKeyOfColumn | null => {
      const { c: columnId, direction }: KeptRecord = isKeptFilterRecord(keptSort) ? keptSort : {};
      return typeof columnId === 'string' && (direction === 'ascending' || direction === 'descending')
        ? {
            c: columnId,
            direction,
          }
        : null;
    }) ?? [];
  return firstSort === undefined ? null : [firstSort, ...otherSorts];
}
export function parseKeptCellTable(kept: unknown): EngineCellTable | null {
  if (!isKeptFilterRecord(kept)) return null;
  const { firstColumn, lastColumn } = kept;
  const [headerRows, footerRows] = [parseKeptRowSpan(kept.headerRows), parseKeptRowSpan(kept.footerRows)];
  return headerRows !== null && typeof firstColumn === 'string' && typeof lastColumn === 'string' && (footerRows !== null || kept.footerRows === null)
    ? {
        headerRows,
        firstColumn,
        lastColumn,
        footerRows,
      }
    : null;
}
export function parseKeptNamedViewInHand(kept: unknown): Pick<KeptOwnFilter, 'namedViewInHand'> {
  let { namedViewId, asked, isSortLeftOut }: KeptRecord = isKeptFilterRecord(kept) ? kept : {};
  return typeof namedViewId === 'string' && typeof asked === 'string' && typeof isSortLeftOut === 'boolean'
    ? {
        namedViewInHand: {
          namedViewId,
          asked,
          isSortLeftOut,
        },
      }
    : {};
}
export function parseKeptOwnFilter(kept: unknown): KeptOwnFilterRead | null {
  if (!isKeptFilterRecord(kept)) return null;
  const { cellTableId } = kept;
  const cellTable = parseKeptCellTable(kept.cellTable);
  const liveCellTable = parseKeptCellTable(kept.liveCellTable);
  const table = parseKeptFilterTable(kept.table);
  const columns = parseEveryKept(kept.columns, parseKeptFilterColumn);
  return (cellTableId === null || typeof cellTableId === 'string') &&
    cellTable !== null &&
    liveCellTable !== null &&
    table !== null &&
    columns !== null
    ? {
        cellTableId,
        cellTable,
        liveCellTable,
        table,
        columns,
        filter: parseKeptAllOf(kept.filter),
        sortBy: parseKeptSortBy(kept.sortBy),
        ...parseKeptNamedViewInHand(kept.namedViewInHand),
      }
    : null;
}
export function withKeptFiltersStorage<Done>(getStorage: () => Storage, useStorage: (storage: Storage) => Done): Done | null {
  try {
    return useStorage(getStorage());
  } catch {
    return null;
  }
}
export function writeKeptOwnFilters(getStorage: () => Storage, viewer: string | null, record: KeptOwnFiltersWrite): void {
  removeKeptOwnFilters(getStorage);
  withKeptFiltersStorage(
    getStorage,
    (storage) =>
      storage.setItem(
        KEPT_OWN_FILTERS_STORAGE_KEY,
        JSON.stringify({
          ...record,
          viewer,
        }),
      ),
  );
}
export function parseKeptFiltersJson(json: string | null): unknown {
  try {
    return json === null ? null : JSON.parse(json);
  } catch {
    return null;
  }
}
export function readKeptOwnFilters(getStorage: () => Storage, viewer: string | null): KeptOwnFiltersRead | null {
  const written = parseKeptFiltersJson(
    withKeptFiltersStorage(getStorage, (storage) => storage.getItem(KEPT_OWN_FILTERS_STORAGE_KEY)),
  );
  return isKeptFilterRecord(written) && written.viewer === viewer
    ? {
        tables: parseEveryKept(written.tables, parseKeptOwnFilter) ?? [],
        written,
      }
    : null;
}
export function takeBrowserKeptOwnFilters(
  { findBrowsers, wallNowMs }: Pick<KeptOwnFiltersStorages, 'findBrowsers' | 'wallNowMs'>,
  viewer: string,
): KeptOwnFilterRead[] {
  const kept = readKeptOwnFilters(findBrowsers, viewer);
  if (kept === null) return [];
  const { keptAtMs, openedUnpainted } = kept.written;
  if (
    typeof keptAtMs !== 'number' ||
    Math.abs(wallNowMs() - keptAtMs) >= KEPT_OWN_FILTERS_MAX_AGE_MS ||
    typeof openedUnpainted !== 'number' ||
    openedUnpainted >= MAX_UNPAINTED_OPENS_OF_KEPT_FILTERS
  ) {
    removeKeptOwnFilters(findBrowsers);
    return [];
  }
  if (kept.tables.length > 0)
    writeKeptOwnFilters(findBrowsers, viewer, {
      ...kept.written,
      openedUnpainted: openedUnpainted + 1,
    });
  return kept.tables;
}
export function takeKeptOwnFilters(storages: KeptOwnFiltersStorages, viewer: string | null): KeptOwnFilterRead[] {
  const keptInTab = readKeptOwnFilters(storages.findTabs, viewer);
  if (viewer !== null && readKeptOwnFilters(storages.findBrowsers, viewer) === null) removeKeptOwnFilters(storages.findBrowsers);
  const tables = keptInTab?.tables ?? (viewer === null ? [] : takeBrowserKeptOwnFilters(storages, viewer));
  writeKeptOwnFilters(storages.findTabs, viewer, {
    tables: [],
    isOpeningWithSome: tables.length > 0,
  });
  return tables;
}
export function clearKeptOwnFilters(storages: KeptOwnFiltersStorages): void {
  const viewer = storages.viewer();
  const keptInTab = readKeptOwnFilters(storages.findTabs, viewer);
  if (keptInTab === null || keptInTab.tables.length > 0 || keptInTab.written.isOpeningWithSome === true)
    forgetBrowserKeptOwnFilters(storages, viewer);
  writeKeptOwnFilters(storages.findTabs, viewer, {
    tables: [],
  });
}
export function keepOwnFiltersAcrossReloads(
  storages: KeptOwnFiltersStorages,
  store: Pick<SheetController, 'ownFilters' | 'subscribe' | 'dispatch' | 'lookOnceAllIsTaken' | 'dropWhatIsHeld'>,
  after: (write: () => void) => void,
  keepPlaceholderOn: () => () => boolean,
): () => void {
  const viewer = storages.viewer();
  const broughtBack = takeKeptOwnFilters(storages, viewer);
  let lastOwnFilters = store.ownFilters();
  let lastTabJson = broughtBack.length > 0 ? null : '[]';
  let lastStamp = keptOwnFiltersStamp(broughtBack);
  let isWritePending = false;
  let isStopped = false;
  const keepInBrowser = (tables: OwnFilterToKeep[]) => {
    const stampBefore = lastStamp;
    lastStamp = keptOwnFiltersStamp(tables);
    const keptInBrowser = readKeptOwnFilters(storages.findBrowsers, viewer);
    const isBrowserCopyCurrent = keptInBrowser !== null && keptOwnFiltersStamp(keptInBrowser.tables) === stampBefore;
    if (viewer === null || (lastStamp === stampBefore && !isBrowserCopyCurrent)) return;
    if (tables.length === 0) return forgetBrowserKeptOwnFilters(storages, viewer);
    writeKeptOwnFilters(storages.findBrowsers, viewer, {
      keptAtMs: storages.wallNowMs(),
      openedUnpainted: 0,
      tables,
    });
  };
  const unsubscribe = store.subscribe(() => {
    if (isWritePending || store.ownFilters() === lastOwnFilters) return;
    isWritePending = true;
    after(() => {
      isWritePending = false;
      if (isStopped || storages.viewer() !== viewer) return;
      lastOwnFilters = store.ownFilters();
      const tables = ownFiltersToKeep({
        ownFilters: lastOwnFilters,
      });
      const tablesJson = JSON.stringify(tables);
      if (tablesJson === lastTabJson) return;
      lastTabJson = tablesJson;
      writeKeptOwnFilters(storages.findTabs, viewer, {
        tables,
      });
      keepInBrowser(tables);
    });
  });
  const dropPlaceholder = broughtBack.length > 0 ? keepPlaceholderOn() : null;
  if (dropPlaceholder !== null)
    try {
      store.dispatch({
        kind: 'ownFiltersBroughtBack',
        kept: broughtBack,
      });
      store.lookOnceAllIsTaken(() => {
        if (!dropPlaceholder() && !isStopped) store.dropWhatIsHeld();
      });
    } catch (error) {
      (dropPlaceholder(), reportError(error));
    }
  return () => {
    isStopped = true;
    dropPlaceholder?.();
    unsubscribe();
  };
}
export const KEPT_OWN_FILTERS_STORAGE_KEY = 'sheets-own-filters';
export const KEPT_OWN_FILTERS_MAX_AGE_MS = 2592000000;
export const MAX_UNPAINTED_OPENS_OF_KEPT_FILTERS = 2;
export const KEPT_COLUMN_KINDS: Record<KindOfAColumn, true> = {
  number: true,
  currency: true,
  percent: true,
  date: true,
  fewWords: true,
  checkbox: true,
  text: true,
};
export const KEPT_RUN_ROLES: Record<RoleOfRows, true> = {
  record: true,
  spacer: true,
  section: true,
  subtotal: true,
  headerAgain: true,
};
export const isKeptFilterRecord = (value: unknown): value is KeptRecord => typeof value === 'object' && value !== null;
export const isKeptColumnKind = (value: unknown): value is KindOfAColumn =>
  typeof value === 'string' && Object.hasOwn(KEPT_COLUMN_KINDS, value);
export const isKeptRunRole = (value: unknown): value is RoleOfRows => typeof value === 'string' && Object.hasOwn(KEPT_RUN_ROLES, value);
/** Only the kind of what is asked is checked; the rest of it is taken as written. */
export const isKeptFilterAsk = (value: unknown): value is Asked => isKeptFilterRecord(value) && typeof value.kind === 'string';
export const removeKeptOwnFilters = (getStorage: () => Storage): void =>
  void withKeptFiltersStorage(getStorage, (storage) => storage.removeItem(KEPT_OWN_FILTERS_STORAGE_KEY));
export const forgetBrowserKeptOwnFilters = ({ findBrowsers }: Pick<KeptOwnFiltersStorages, 'findBrowsers'>, viewer: string | null): void =>
  void (readKeptOwnFilters(findBrowsers, viewer) !== null && removeKeptOwnFilters(findBrowsers));
export const keptOwnFiltersStamp = (tables: readonly Pick<KeptOwnFilter, 'table' | 'filter' | 'sortBy' | 'namedViewInHand'>[]): string =>
  JSON.stringify(
    tables.map(
      ({ table: { sheetId, firstColumn, header }, filter, sortBy, namedViewInHand }) => [
        sheetId,
        [firstColumn, header.firstRow, header.lastRow],
        filter,
        sortBy,
        namedViewInHand,
      ],
    ),
  );
