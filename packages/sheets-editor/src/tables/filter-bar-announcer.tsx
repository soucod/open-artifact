import type { SheetId } from '@open-artifact/sheets-core';
import * as React from 'react';
import { filterMessages, sortMessages, rowsInViewOfAllText } from './filter-messages.ts';
import { sortedByWords } from './sort-filter-labels.ts';
import { LAST_DONE_SETTLE_MS } from '../ui/last-done-announcer.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import type { OwnFilterBar } from './own-filter-bar.ts';
import type { RecordCountsOfFilter } from './own-filters.ts';
import type { PageView } from '../view/page-view.ts';
/** The bar of a filter not drawn yet: only its sheet and the records it lets through, with no sort and nothing asked yet. */
export interface FilterBarNotDrawnYet {
  sheetId: SheetId;
  records: RecordCountsOfFilter | null;
  isRefreshOffered: false;
  isNotDrawnYet: true;
  sort?: undefined;
  isNothingAsked?: undefined;
}
/** The filter bar whose changes are announced: as drawn, or of a filter not drawn yet. */
export type FilterBarToAnnounce = (OwnFilterBar & { isNotDrawnYet?: undefined }) | FilterBarNotDrawnYet;
/** What was last said of a sheet's filter bar. */
export interface FilterBarAnnouncement {
  sheetId: SheetId;
  isOfAllRows: boolean;
  words: string;
}
/** The filter bar as it stands now, and whether its filters were just cleared. */
export interface FilterBarShown {
  bar: FilterBarToAnnounce | null;
  isCleared: boolean;
}
/** Says what changes on the filter bar, once the changes settle. */
export interface FilterBarAnnouncer {
  give(shown: FilterBarShown): void;
  stop(): void;
}
export type FilterBarAnnouncerProps = FilterBarShown;
export function filterBarAnnouncement(bar: FilterBarToAnnounce, previous: FilterBarAnnouncement | null): FilterBarAnnouncement {
  let { sheetId, records } = bar;
  let { sort = null, isNothingAsked = false } = bar;
  if (bar.isRefreshOffered) {
    let words = sort === null ? filterMessages.refreshFilter() : sortMessages.refresh(!isNothingAsked);
    return {
      sheetId,
      isOfAllRows: false,
      words,
    };
  }
  if (sort !== null && isNothingAsked)
    return {
      sheetId,
      isOfAllRows: false,
      words: sortedByWords(sort.said),
    };
  if (records !== null)
    return {
      sheetId,
      isOfAllRows: false,
      words: rowsInViewOfAllText(records),
    };
  const isSameSheet = previous?.sheetId === sheetId;
  if (isSameSheet && previous.isOfAllRows) return previous;
  let words = isSameSheet ? filterMessages.allRowsAreShowing() : filterMessages.filterOnWithAllRows();
  return {
    sheetId,
    isOfAllRows: true,
    words,
  };
}
export function createFilterBarAnnouncer(announce: (words: string | null) => void): FilterBarAnnouncer {
  let lastAnnouncement: FilterBarAnnouncement | null = null;
  let lastSeen = '';
  let isOnlySorted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    give({ bar, isCleared }: FilterBarShown) {
      let isNotDrawnYet = bar?.isNotDrawnYet === true && bar.records === null;
      let seen = JSON.stringify([
        bar === null ? null : [bar.sheetId, bar.records, bar.isRefreshOffered, isNotDrawnYet, bar.sort?.said],
        isCleared,
      ]);
      if (seen === lastSeen) return;
      lastSeen = seen;
      if (bar !== null) isOnlySorted = (bar.sort ?? null) !== null && bar.isNothingAsked === true;
      clearTimeout(timer);
      if ((bar === null && !isCleared) || (isNotDrawnYet && lastAnnouncement === null)) {
        lastAnnouncement = null;
        return announce(null);
      }
      timer = setTimeout(() => {
        lastAnnouncement = bar === null ? null : filterBarAnnouncement(bar, lastAnnouncement);
        announce(lastAnnouncement?.words ?? (isOnlySorted ? sortMessages.cleared() : filterMessages.filterCleared()));
      }, LAST_DONE_SETTLE_MS);
    },
    stop() {
      lastSeen = '';
      clearTimeout(timer);
    },
  };
}
export function FilterBarAnnouncer({ bar, isCleared }: FilterBarAnnouncerProps) {
  let [words, setWords] = React.useState<string | null>(null);
  let [announcer] = React.useState(() => createFilterBarAnnouncer(setWords));
  React.useEffect(
    () =>
      announcer.give({
        bar,
        isCleared,
      }),
    [announcer, bar, isCleared],
  );
  React.useEffect(() => announcer.stop, [announcer]);
  return <LiveAnnouncer words={words} />;
}
export const filterBarToAnnounce = (
  { ownFilterBar, hasFilterNotDrawnYet, recordsUnderFilterNotDrawnYet }: Pick<PageView, 'ownFilterBar' | 'hasFilterNotDrawnYet' | 'recordsUnderFilterNotDrawnYet'>,
  sheetId: SheetId | null,
): FilterBarToAnnounce | null =>
  !hasFilterNotDrawnYet || sheetId === null || (recordsUnderFilterNotDrawnYet === null && ownFilterBar !== null)
    ? ownFilterBar
    : {
        sheetId,
        records: recordsUnderFilterNotDrawnYet,
        isRefreshOffered: false,
        isNotDrawnYet: true,
      };
