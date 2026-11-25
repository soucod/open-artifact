import type { ValueContents } from '@open-artifact/sheets-core';
import type { ColumnHolds, ColumnValueHeld, SuggestedAsk, SuggestedAskWhat, TableHolds } from '../state/initial-state.ts';
import type { SortKeyOfColumn } from '../state/event-reducer.ts';
import { filterOfEntries, filterEntry } from '../tables/filter-model.ts';
/** Values a column holds, as found for an ask. */
export interface ValuesFound {
  column: ColumnHolds;
  values: ColumnValueHeld[];
}
/** The values of a column that read as a status, and the status as said. */
export interface StatusValues extends ValuesFound {
  label: string;
}
export function viewersValuesColumn(columns: ColumnHolds[], viewerId: string | null): ValuesFound | null {
  let [found, ...others] = columns.flatMap((column): ValuesFound[] => {
    let viewersValues = column.values.filter(({ userIds }) => viewerId !== null && userIds.includes(viewerId));
    return viewersValues.length === 0
      ? []
      : [
          {
            column,
            values: viewersValues,
          },
        ];
  });
  return others.length > 0 || found?.column.areMoreValuesLeftOut === true ? null : (found ?? null);
}
export function suggestedAsksOf(holds: TableHolds, viewerId: string | null): SuggestedAsk[] {
  let { columns } = holds;
  let priorityColumn = columns.find((column) => column.name !== null && isPriorityColumn(column));
  let byPriority: SortKeyOfColumn[] =
    priorityColumn === undefined
      ? NO_SORT_KEYS
      : [
          {
            c: priorityColumn.c,
            direction: 'ascending',
          },
        ];
  let suggestAsk = (
    what: SuggestedAskWhat,
    valuesFound: ValuesFound | null,
    kind: 'isOneOf' | 'isNoneOf',
    sortBy: SortKeyOfColumn[] = NO_SORT_KEYS,
  ): SuggestedAsk[] => {
    let [firstValue, ...otherValues] = valuesFound?.values.map(({ value }) => value) ?? [];
    if (valuesFound === null || firstValue === undefined) return [];
    let recordsOfValues = valuesFound.values.reduce((sum, { records: valueRecords }) => sum + valueRecords, 0);
    let records = kind === 'isOneOf' ? recordsOfValues : holds.records - recordsOfValues;
    if (records <= 0 || records >= holds.records) return [];
    let filter = filterOfEntries([
      filterEntry(valuesFound.column.c, {
        kind,
        values: [firstValue, ...otherValues],
      }),
    ]);
    return [
      {
        what,
        asked: {
          filter,
          sortBy,
        },
        records,
      },
    ];
  };
  let viewersValues = viewersValuesColumn(columns, viewerId);
  let priorityName = priorityColumn?.name ?? null;
  return [
    ...(priorityName === null
      ? []
      : suggestAsk(
          {
            kind: 'mineSorted',
            column: priorityName,
          },
          viewersValues,
          'isOneOf',
          byPriority,
        )),
    ...suggestAsk(
      {
        kind: 'mine',
      },
      viewersValues,
      'isOneOf',
    ),
    ...statusValuesMatching(columns, doneStatusPattern)
      .flatMap(
        (status) =>
          suggestAsk(
            {
              kind: 'allBut',
              label: status.label,
            },
            status,
            'isNoneOf',
          ),
      )
      .slice(0, 1),
    ...statusValuesMatching(columns, inProgressStatusPattern)
      .flatMap(
        (status) =>
          suggestAsk(
            {
              kind: 'only',
              label: status.label,
            },
            status,
            'isOneOf',
          ),
      )
      .slice(0, 1),
    ...(priorityName === null || holds.records < 2
      ? []
      : ([
          {
            what: {
              kind: 'sorted',
              column: priorityName,
            },
            asked: {
              filter: null,
              sortBy: byPriority,
            },
            records: null,
          },
        ] satisfies SuggestedAsk[])),
  ];
}
export const doneStatusPattern = /^(?:shipped|done|complete|completed|closed|finished|resolved)$/i;
export const isDoneStatus = (text: string): boolean => doneStatusPattern.test(text.trim());
export const inProgressStatusPattern = /^(?:in progress|doing|started|under way|active)$/i;
export const priorityLevelPattern = /^p\d+$/i;
export const isChoiceColumn = ({ kind, optionsOfDropdown }: Pick<ColumnHolds, 'kind' | 'optionsOfDropdown'>): boolean =>
  optionsOfDropdown !== null || kind === 'fewWords';
export const textOfFilterValue = (value: ValueContents | null): string | null => (value?.kind === 'text' ? value.value : null);
export const statusValuesMatching = (columns: ColumnHolds[], pattern: RegExp): StatusValues[] =>
  columns.filter(isChoiceColumn).flatMap(
    (column) =>
      column.values.flatMap((held): StatusValues[] => {
        let label = textOfFilterValue(held.value)?.trim() ?? '';
        return pattern.test(label)
          ? [
              {
                column,
                values: [held],
                label,
              },
            ]
          : [];
      }),
  );
export const isPriorityColumn = (column: ColumnHolds): boolean =>
  column.optionsOfDropdown !== null &&
  column.values.length > 1 &&
  (/^(?:prio|priority|priorities)$/i.test(column.name?.trim() ?? '') ||
    column.values.filter(({ value }) => priorityLevelPattern.test(textOfFilterValue(value) ?? '')).length > 1);
export const NO_SORT_KEYS: SortKeyOfColumn[] = [];
