import type { ColumnId, NamedView } from '@open-artifact/sheets-core';
import { keepFilterClausesWhereColumns } from './filter-model.ts';
import type { FilterTerm } from './filter-model.ts';
import { isSameJsonValue } from '../model/same-json.ts';
import type { LimitsOfNamedViews, WorkbookReads } from '../model/workbook.ts';
import type { FilterTable, OwnFilter } from './own-filters.ts';
/** The filter and the sort a named view asks for. */
export type NamedViewSettings = Pick<NamedView, 'filter' | 'sortBy'>;
/** A named view of a table, with its id. */
export interface NamedViewOfTable extends NamedView {
  namedViewId: string;
}
/** The id and the name of a named view, as names are checked against the other views of the sheet. */
export type NamedViewName = Pick<NamedViewOfTable, 'namedViewId' | 'name'>;
/** The named view a table shows, and whether its filter or sort was changed since it was picked. */
export interface NamedViewShown extends NamedViewOfTable {
  isEdited: boolean;
}
/** The named view a table was last set to: its id, the filter and sort it asked for then, and whether its sort was left out. */
export interface NamedViewInHand {
  namedViewId: string;
  asked: string;
  isSortLeftOut: boolean;
}
/** The named views the filter bar offers for one table. */
export interface NamedViewsOfTable {
  tableKey: string;
  all: NamedViewOfTable[];
  allInSheet: NamedViewName[];
  inHand: NamedViewShown | null;
  isAnythingAsked: boolean;
  limits: LimitsOfNamedViews;
}
export function namedViewsOfOwnFilter(
  reads: WorkbookReads,
  {
    cellTableId,
    table: { sheetId },
    columns,
  }: Pick<FilterTable, 'cellTableId' | 'table' | 'columns'>,
): NamedViewOfTable[] | null {
  let tableIds = new Set(
    reads
      .cellTablesDeclaredIn(sheetId)
      .map((cellTable) => cellTable.cellTableId),
  );
  if (cellTableId === null || !tableIds.has(cellTableId)) return null;
  let belongsHere = (namedView: NamedView): boolean => {
      if (tableIds.has(namedView.cellTableId))
        return namedView.cellTableId === cellTableId;
      let usedColumns = [
        ...(namedView.filter?.allOf.flatMap(
          ({ anyOf }) => anyOf,
        ) ?? []),
        ...namedView.sortBy,
      ];
      return (
        usedColumns.length === 0 ||
        usedColumns.some(({ c: columnId }) =>
          columns.some((tableColumn) => tableColumn.c === columnId),
        )
      );
    },
    namedViews: NamedViewOfTable[] = reads
      .namedViewsIn(sheetId)
      .filter(({ namedView }) => belongsHere(namedView))
      .map(({ namedViewId, namedView: settings }) =>
        Object.assign(
          {
            namedViewId,
          },
          settings,
        ),
      );
  return (
    namedViews.sort((namedView, other) =>
      namedView.name.localeCompare(other.name, undefined, {
        numeric: true,
      }),
    ),
    namedViews
  );
}
export function namedViewOnTable(
  { filter, sortBy }: NamedViewSettings,
  { columns }: Pick<FilterTable, 'columns'>,
): NamedViewSettings {
  let isColumnOfTable = (columnId: ColumnId): boolean =>
    columns.some((column) => column.c === columnId);
  return {
    filter:
      filter === null
        ? null
        : keepFilterClausesWhereColumns(
            filter,
            isColumnOfTable,
          ),
    sortBy: sortBy.filter(({ c: columnId }) =>
      isColumnOfTable(columnId),
    ),
  };
}
export function namedViewsOfFilterBar(reads: WorkbookReads, ownFilters: readonly OwnFilter[]): NamedViewsOfTable | null {
  let viewsOfTables = ownFilters.flatMap((ownFilter): NamedViewsOfTable | NamedViewsOfTable[] => {
    let namedViews = namedViewsOfOwnFilter(reads, ownFilter);
    if (namedViews === null) return [];
    let settings = namedViewSettingsOf(ownFilter),
      inHand = namedViews.find((namedView) =>
        isNamedViewInHand(namedView, ownFilter),
      ),
      isEdited = (namedView: NamedViewOfTable): boolean => {
        let { filter, sortBy } = namedViewOnTable(
            namedView,
            ownFilter,
          ),
          isSortLeftOut =
            ownFilter.namedViewInHand?.isSortLeftOut === true;
        return !isSameJsonValue(
          {
            filter,
            sortBy: isSortLeftOut ? [] : sortBy,
          },
          settings,
        );
      };
    return {
      tableKey: ownFilter.key,
      all: namedViews,
      allInSheet: reads
        .namedViewsIn(ownFilter.table.sheetId)
        .map(
          ({
            namedViewId,
            namedView: { name },
          }) => ({
            namedViewId,
            name,
          }),
        ),
      inHand:
        inHand === undefined
          ? null
          : {
              ...inHand,
              isEdited: isEdited(inHand),
            },
      isAnythingAsked: settings.filter !== null || settings.sortBy.length > 0,
      limits: reads.limitsOfNamedViews(),
    };
  });
  return (
    viewsOfTables.find(({ inHand }) => inHand !== null) ??
    viewsOfTables.find(
      ({ isAnythingAsked }) => isAnythingAsked,
    ) ??
    viewsOfTables[0] ??
    null
  );
}
export const namedViewAskedKey = ({ filter, sortBy }: NamedViewSettings): string =>
  JSON.stringify([filter, sortBy]);
export const isNamedViewInHand = (
  namedView: Pick<NamedViewOfTable, 'namedViewId' | 'filter' | 'sortBy'>,
  { namedViewInHand }: Pick<OwnFilter, 'namedViewInHand'>,
): boolean =>
  namedView.namedViewId === namedViewInHand?.namedViewId &&
  namedViewAskedKey(namedView) === namedViewInHand.asked;
export const withoutRepeatedBlank = (line: FilterTerm): FilterTerm => {
  if (line.asked.kind === 'meets') return line;
  let [first, ...rest] = line.asked.values.filter(
    (value, index, values) =>
      value !== null || values.indexOf(null) === index,
  );
  return first === undefined
    ? line
    : {
        ...line,
        asked: {
          ...line.asked,
          values: [first, ...rest],
        },
      };
};
export const mapFirstAndRest = <Item, Mapped>([first, ...rest]: readonly Item[], mapItem: (item: Item) => Mapped): Mapped[] => [
  mapItem(first),
  ...rest.map(mapItem),
];
export const namedViewSettingsOf = ({ filter, sort }: Pick<OwnFilter, 'filter' | 'sort'>): NamedViewSettings => ({
  filter:
    filter === null
      ? null
      : {
          allOf: mapFirstAndRest(
            filter.allOf,
            ({ anyOf }) => ({
              anyOf: mapFirstAndRest(anyOf, withoutRepeatedBlank),
            }),
          ),
        },
  sortBy: [...(sort?.by ?? [])],
});
