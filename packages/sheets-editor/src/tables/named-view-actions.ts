import type { NamedView } from '@open-artifact/sheets-core';
import {
  refreshStaleOwnFilters,
  ownFilterByKey,
  applyOwnFilter,
  isOwnFilterSortable,
  sortOwnFilter,
  withNamedViewInHand,
  ownFiltersOfSheet,
} from './own-filters.ts';
import { namedViewsOfOwnFilter, namedViewOnTable, namedViewAskedKey, namedViewSettingsOf, isNamedViewInHand } from './named-view-model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { IF_QUEUED_DEFAULTS, queueEdit } from '../model/edit-effects.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { OwnSortIsOverNotice, PageState } from '../state/initial-state.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { AskedKindOfEdit } from '../state/edit-answers.ts';
/** What was last done to a named view, told to screen readers. */
export interface NamedViewDone {
  what: 'namedViewPicked' | 'namedViewSaved' | 'namedViewUpdated' | 'namedViewRenamed';
  name: string;
}
/** The offer to undo the delete of a named view. */
export interface NamedViewDeletedOffer {
  kind: 'namedViewDeleted';
  name: string;
  isSaved: boolean;
}
/** A change asked of a table's named views: save the filter and sort as a new one, update, rename or delete one. */
export type NamedViewChange =
  | { kind: 'save'; name: string }
  | { kind: 'update' | 'delete'; namedViewId: string }
  | { kind: 'rename'; namedViewId: string; name: string };
/** The page with a named view picked, or `null` when it could not be; and the page to tell either way. */
export interface NamedViewPicked {
  picked: PageState | null;
  told: PageState;
}
/** A named view as it is saved, before the cell table it was made for is added. */
type NamedViewToSave = Omit<NamedView, 'cellTableId'>;
export function pickNamedView(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  tableKey: string,
  namedViewId: string,
): NamedViewPicked {
  let refreshed = refreshStaleOwnFilters(
      state,
      reads,
      state.sheetId,
    ),
    ownFilter = ownFilterByKey(
      refreshed,
      tableKey,
    ),
    namedView = (
      ownFilter === null
        ? null
        : namedViewsOfOwnFilter(reads, ownFilter)
    )?.find((candidate) => candidate.namedViewId === namedViewId);
  if (ownFilter === null || namedView === undefined)
    return {
      picked: null,
      told: refreshed,
    };
  let { filter, sortBy } = namedViewOnTable(namedView, ownFilter),
    filtered = applyOwnFilter(
      {
        ...refreshed,
        notice: null,
      },
      reads,
      ownFilter,
      filter,
    ),
    filteredOwnFilter = ownFilterByKey(
      filtered,
      tableKey,
    );
  if (filteredOwnFilter?.filter !== filter)
    return {
      picked: null,
      told: filtered,
    };
  let [firstSortKey, ...otherSortKeys] = sortBy,
    isSortLeftOut =
      firstSortKey !== undefined &&
      !isOwnFilterSortable(reads, filteredOwnFilter),
    sortToApply =
      firstSortKey === undefined || isSortLeftOut
        ? null
        : [firstSortKey, ...otherSortKeys],
    sorted =
      sortToApply === null && filteredOwnFilter.sort === null
        ? filtered
        : sortOwnFilter(
            filtered,
            reads,
            filteredOwnFilter,
            sortToApply,
          ),
    saysSortLeftOut =
      isSortLeftOut &&
      ownFilter.table.firstRowOfBody !== ownFilter.table.lastRowOfBody,
    why: OwnSortIsOverNotice['why'] =
      filter === null ? 'leftOutOfNamedView' : 'leftOutOfNamedViewWithFilter',
    picked: PageState = {
      ...withNamedViewInHand(sorted, tableKey, {
        namedViewId,
        asked: namedViewAskedKey(namedView),
        isSortLeftOut,
      }),
      lastDone: {
        what: 'namedViewPicked',
        name: namedView.name,
      },
      notice: saysSortLeftOut
        ? {
            kind: 'ownSortIsOver',
            why,
          }
        : sorted.notice,
    };
  return {
    picked,
    told: picked,
  };
}
export function takeSavedNamedView(state: PageState, reads: WorkbookReads, event: PageEvent): PageState {
  if (event.kind !== 'editAnswered' || event.outcome.kind === 'refused')
    return state;
  let { edit } = event,
    { done } = event.ifQueued,
    isRename =
      typeof done === 'object' && done?.what === 'namedViewRenamed';
  if (edit.kind !== 'saveNamedView' || isRename) return state;
  return ownFiltersOfSheet(state, edit.sheetId).reduce(
    (current: PageState, ownFilter) => {
      let namedView = namedViewsOfOwnFilter(
        reads,
        ownFilter,
      )?.find((candidate) =>
        edit.namedViewId === null
          ? candidate.name === edit.namedView.name
          : candidate.namedViewId === edit.namedViewId,
      );
      if (namedView === undefined) return current;
      let isSortLeftOut =
          ownFilter.sort === null && namedView.sortBy.length > 0,
        { namedViewId } = namedView;
      return withNamedViewInHand(current, ownFilter.key, {
        namedViewId,
        asked: namedViewAskedKey(namedView),
        isSortLeftOut,
      });
    },
    state,
  );
}
export function changeNamedView(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  tableKey: string,
  change: NamedViewChange,
): PageTransition {
  let refreshed = refreshStaleOwnFilters(
      state,
      reads,
      state.sheetId,
    ),
    ownFilter = ownFilterByKey(
      refreshed,
      tableKey,
    ),
    namedViews =
      ownFilter === null
        ? null
        : namedViewsOfOwnFilter(reads, ownFilter),
    cellTableId = ownFilter?.cellTableId ?? null;
  if (ownFilter === null || namedViews === null || cellTableId === null)
    return withNoEffects(refreshed);
  let cleared: PageState = {
      ...refreshed,
      lastDone: null,
      notice: null,
    },
    { sheetId } = ownFilter.table,
    ifQueued = {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      leavesEntryOpen: true,
    },
    saveNamedView = (
      namedViewToSave: NamedViewToSave,
      savedNamedViewId: string | null,
      done: Exclude<NamedViewDone['what'], 'namedViewPicked'>,
    ): PageTransition =>
      queueEdit(
        cleared,
        {
          kind: 'saveNamedView',
          sheetId,
          namedViewId: savedNamedViewId,
          namedView: {
            ...namedViewToSave,
            cellTableId,
          },
        },
        {
          ...ifQueued,
          done: {
            what: done,
            name: namedViewToSave.name,
          },
        },
      ),
    settings = namedViewSettingsOf(ownFilter);
  if (change.kind === 'save')
    return saveNamedView(
      {
        ...settings,
        name: cleanNamedViewName(change.name),
      },
      null,
      'namedViewSaved',
    );
  let { namedViewId } = change,
    namedView = namedViews.find(
      (candidate) => candidate.namedViewId === namedViewId,
    );
  if (namedView === undefined) {
    if (change.kind === 'delete')
      return withNoEffects(cleared);
    let asked: AskedKindOfEdit =
      change.kind === 'update' ? 'updateOfNamedView' : 'renameOfNamedView';
    return withNoEffects({
      ...cleared,
      notice: {
        kind: 'editRefused',
        why: 'namedViewIsGone',
        asked,
      },
    });
  }
  let { filter, sortBy } = namedView;
  if (change.kind === 'update') {
    if (!isNamedViewInHand(namedView, ownFilter))
      return withNoEffects(cleared);
    let keepsSort =
        ownFilter.sort === null &&
        (ownFilter.namedViewInHand?.isSortLeftOut === true ||
          !isOwnFilterSortable(reads, ownFilter)),
      updated: NamedViewToSave = {
        ...settings,
        ...(keepsSort && {
          sortBy,
        }),
        name: namedView.name,
      };
    return saveNamedView(updated, namedViewId, 'namedViewUpdated');
  }
  if (change.kind === 'rename') {
    let renamed: NamedViewToSave = {
      filter,
      sortBy,
      name: cleanNamedViewName(change.name),
    };
    return saveNamedView(renamed, namedViewId, 'namedViewRenamed');
  }
  return queueEdit(
    cleared,
    {
      kind: 'removeNamedView',
      sheetId,
      namedViewId,
    },
    {
      ...ifQueued,
      done: null,
      undoOffer: {
        kind: 'namedViewDeleted',
        name: namedView.name,
        isSaved: false,
      },
    },
  );
}
export const cleanNamedViewName = (name: string): string =>
  name.replaceAll(/\p{Cc}/gu, ' ').trim();
