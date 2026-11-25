import type { Edit, Filter } from '@open-artifact/sheets-core';
import { filterOfEntries } from './filter-model.ts';
import { ownFiltersOfSheet, refreshStaleOwnFilters } from './own-filters.ts';
import { ownFilterRecordsArea } from './own-filter-actions.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
/** An edit that puts rows in. */
type InsertRowsEdit = Extract<Edit, { kind: 'insertRows' }>;
export function filterValuesOfRowsAt(
  state: Pick<PageState, 'ownFilters'>,
  reads: WorkbookReads,
  { sheetId, afterRow }: Pick<InsertRowsEdit, 'sheetId' | 'afterRow'>,
): Filter | null {
  const afterRowIndex = afterRow === null ? -1 : reads.rowIndexOf(sheetId, afterRow);
  if (afterRowIndex === null) return null;
  return filterOfEntries(
    ownFiltersOfSheet(state, sheetId).flatMap((ownFilter) => {
      const area = ownFilterRecordsArea(reads, ownFilter);
      return area !== null && afterRowIndex >= area.topRowIndex - 1 && afterRowIndex < area.topRowIndex + area.rowCount
        ? (ownFilter.filter?.allOf ?? [])
        : [];
    }),
  );
}
export function addFilterValuesToInserts(step: PageTransition, reads: ReadsWithTextMeasurer): PageTransition {
  const { state } = step;
  if (state.ownFilters.size === 0) return step;
  const effects = step.effects.map((effect) => {
    if (effect.kind !== 'queueEdit' || effect.edit.kind !== 'insertRows') return effect;
    if (effect.ifQueued.entryBeforeLine !== undefined) return effect;
    const stateFresh = refreshStaleOwnFilters(state, reads, effect.edit.sheetId);
    const filterValues = filterValuesOfRowsAt(stateFresh, reads, effect.edit);
    return filterValues === null
      ? effect
      : {
          ...effect,
          edit: {
            ...effect.edit,
            valuesFromFilter: filterValues,
          },
        };
  });
  return {
    ...step,
    effects,
  };
}
