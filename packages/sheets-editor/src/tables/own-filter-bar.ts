import type { ColumnId, RowId, SheetId } from '@open-artifact/sheets-core';
import {
  drawnOwnFiltersOfSheet,
  rowsOutOfViewByOwnFiltersOn,
  lookStampOfWorkbook,
  areOwnFiltersInForce,
  areSortedRowsInOrder,
  isFilterTableEmpty,
} from './own-filters.ts';
import { columnsOfFilterItem } from './filter-model.ts';
import { namedViewsOfFilterBar } from './named-view-model.ts';
import type { NamedViewsOfTable } from './named-view-model.ts';
import { areasToA1AsStored } from '../formulas/from-words/where.ts';
import { areasOfRuleRanges } from '../format/conditional/descriptions.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { OwnFilter, RecordCountsOfFilter, SaidOfFilterItem, SaidOfSortColumn } from './own-filters.ts';
/** The sort the filter bar tells of: its table, its first column, how it is said, and whether it could be everyone's. */
export interface OwnFilterBarSort {
  tableKey: string;
  c: ColumnId;
  said: SaidOfSortColumn[];
  canBeForEveryone: boolean;
}
/** A line of a filter on the bar, and the one column it tests, if it tests only one. */
export interface OwnFilterBarLine {
  tableKey: string;
  lineIndex: number;
  line: SaidOfFilterItem[];
  c: ColumnId | null;
}
/** The bar over a sheet with filters of the viewer's own: what it filters and sorts by, and what it offers. */
export interface OwnFilterBar {
  sheetId: SheetId;
  sort: OwnFilterBarSort | null;
  namedViews: NamedViewsOfTable | null;
  isNothingAsked: boolean;
  /** `null` while the counts are not known or a refresh is offered. */
  records: RecordCountsOfFilter | null;
  lines: OwnFilterBarLine[];
  /** The cells beside the tables the filters hide, in A1 notation; `''` when a refresh is offered. */
  cellsBesideOutOfView: string;
  isRefreshOffered: boolean;
  behindAsOf: number | null;
  dayAwaitedSinceTry: number | null;
}
/** A bar worked out, and what it was worked out from. */
interface OwnFilterBarCached {
  reads: WorkbookReads;
  asOf: number;
  outOfView: Set<RowId>;
  ownRowOrders: PageState['ownRowOrders'];
  bar: OwnFilterBar;
}
export function ownFilterBar(state: PageState, reads: WorkbookReads): OwnFilterBar | null {
  const drawn = drawnOwnFiltersOfSheet(state, state.sheetId);
  if (drawn.length === 0) return null;
  const cached = ownFilterBarCache.get(drawn);
  const outOfView = rowsOutOfViewByOwnFiltersOn(state, state.sheetId);
  const { ownRowOrders } = state;
  if (cached?.reads === reads && cached.asOf === lookStampOfWorkbook(state) && cached.outOfView === outOfView && cached.ownRowOrders === ownRowOrders)
    return cached.bar;
  const bar = buildOwnFilterBar(state, reads, drawn);
  ownFilterBarCache.set(drawn, {
    reads,
    asOf: lookStampOfWorkbook(state),
    outOfView,
    ownRowOrders,
    bar,
  });
  return bar;
}
export function buildOwnFilterBar(state: PageState, reads: WorkbookReads, ownFilters: OwnFilter[]): OwnFilterBar {
  const { sheetId } = state;
  const rowsOfFilters = ownFilters.flatMap(({ rows }) => rows ?? []);
  const isRefreshOffered =
    ownFilters.some(({ unanswered, sort }) => unanswered !== null || sort?.isRefused === true) ||
    !areOwnFiltersInForce(state, reads, sheetId, ownFilters) ||
    !areSortedRowsInOrder(state, reads, sheetId, ownFilters);
  const [sort = null] = ownFilters.flatMap((ownFilter): OwnFilterBarSort | OwnFilterBarSort[] => {
    if (ownFilter.sort === null) return [];
    const { by, said } = ownFilter.sort;
    return {
      tableKey: ownFilter.key,
      c: by[0].c,
      said,
      canBeForEveryone: isFilterTableEmpty(ownFilter),
    };
  });
  const dayTries = ownFilters.flatMap(
    ({ unanswered }) => (unanswered?.why === 'dayIsNotKnown' ? [unanswered.tries] : []),
  );
  return {
    sheetId,
    sort,
    namedViews: namedViewsOfFilterBar(reads, ownFilters),
    isNothingAsked: ownFilters.every(({ filter }) => filter === null),
    records:
      rowsOfFilters.length === 0 || isRefreshOffered
        ? null
        : {
            inView: rowsOfFilters.reduce((total, { recordsInView }) => total + recordsInView, 0),
            all: rowsOfFilters.reduce((total, { records }) => total + records, 0),
          },
    lines: ownFilters.flatMap(
      ({ key, lines, filter }) =>
        lines.map((line, lineIndex): OwnFilterBarLine => {
          const [onlyColumn, ...otherColumns] = [...new Set(filter?.allOf[lineIndex]?.anyOf.flatMap(columnsOfFilterItem) ?? [])];
          return {
            tableKey: key,
            lineIndex,
            line,
            c: otherColumns.length > 0 ? null : (onlyColumn ?? null),
          };
        }),
    ),
    cellsBesideOutOfView: isRefreshOffered
      ? ''
      : areasToA1AsStored(
          areasOfRuleRanges(
            reads,
            sheetId,
            rowsOfFilters.flatMap(({ cellsBesideTheTableOutOfView }) => cellsBesideTheTableOutOfView),
          ),
          ownRowOrderOfSheet(reads, sheetId),
        ),
    isRefreshOffered,
    behindAsOf: ownFilters.some(({ lookedAtAsOf }) => lookedAtAsOf !== lookStampOfWorkbook(state))
      ? lookStampOfWorkbook(state)
      : null,
    dayAwaitedSinceTry: dayTries.length === 0 ? null : Math.max(...dayTries),
  };
}
export const ownFilterBarCache = new WeakMap<OwnFilter[], OwnFilterBarCached>();
