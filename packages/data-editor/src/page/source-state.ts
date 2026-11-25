/**
 * The state a page shows for its sources, as plain functions: what one run of a source stamps on the marks that use
 * it, and what the page's root says once every mark is known.
 */

import type { DatasetRun } from '@open-artifact/data-core';
import { getRunTable, isFailedDatasetRun } from '../data/query-store.ts';

/**
 * A mark's `data-dash-source-state`. `stale` is a failed run that still has rows up from an earlier good one, so its
 * marks keep their old values.
 */
export type PageSourceState = 'error' | 'stale' | 'loading' | 'refreshing' | 'empty';

/** The state that wins when a mark draws on several sources (`empty` is decided from the mark's own text). */
export const MARK_STATE_ORDER: readonly PageSourceState[] = ['error', 'loading', 'refreshing', 'stale'];

/** The state one run gives its marks. `loads` says whether an idle source is waiting to load. */
export function runSourceState(run: DatasetRun, loads: boolean): PageSourceState | undefined {
  switch (run.status) {
    case 'idle':
      return loads ? 'loading' : undefined;
    case 'running':
      return getRunTable(run) === null ? 'loading' : 'refreshing';
    case 'ok':
      return undefined;
    default:
      if (!isFailedDatasetRun(run)) return undefined;
      return getRunTable(run) === null ? 'error' : 'stale';
  }
}

/** The first of {@link MARK_STATE_ORDER} among a mark's source states. */
export function strongestMarkState(states: readonly (PageSourceState | undefined)[]): PageSourceState | undefined {
  return MARK_STATE_ORDER.find((state) => states.includes(state));
}

/**
 * `#dash-root`'s `data-dash-state`: `loading` once the loading spell shows, else `error` while any source failed,
 * rows left up or not.
 */
export function rootPageState(states: readonly (PageSourceState | undefined)[], spellShown: boolean): 'loading' | 'error' | undefined {
  if (spellShown) return 'loading';
  return states.some((state) => state === 'error' || state === 'stale') ? 'error' : undefined;
}
