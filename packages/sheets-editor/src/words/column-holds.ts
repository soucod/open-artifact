import type { KindOfAColumn, ValueContents } from '@open-artifact/sheets-core';
import type { ColumnHolds } from '../state/initial-state.ts';
export function isPeopleColumn(column: ColumnHolds): boolean {
  let isPeople = peopleColumnCache.get(column) ?? column.values.some(({ userIds }) => userIds.length > 0);
  peopleColumnCache.set(column, isPeople);
  return isPeople;
}
export const peopleColumnCache = new WeakMap<ColumnHolds, boolean>();
export const valuesOfUserInColumn = (columnHolds: ColumnHolds, userId: string | null): (ValueContents | null)[] =>
  userId === null || columnHolds.areMoreValuesLeftOut
    ? []
    : columnHolds.values
        .filter(({ userIds }) => userIds.includes(userId))
        .map(({ value }) => value);
export const measureOfColumn = ({ kind }: { kind: KindOfAColumn }): 'numbers' | 'days' | null =>
  kind === 'number' || kind === 'currency' || kind === 'percent' ? 'numbers' : kind === 'date' ? 'days' : null;
