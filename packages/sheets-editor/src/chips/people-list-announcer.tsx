import * as React from 'react';
import { peoplePickerMessages } from '../i18n/chip-labels.ts';
import { peopleListNote } from './people-list-view.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import type { PeopleListView } from '../view/page-view.ts';
/** What was last said of a people search: nothing, that it is under way, or how many people it found. */
export type SaidOfSearch = 'nothing' | 'searching' | number;
/** What was last said of a people search, and the search found slow to answer, if any. */
export interface PeopleSearchSaid {
  said: SaidOfSearch;
  slowAt: string | null;
}
export interface PeopleListAnnouncerProps {
  list: PeopleListView | null;
}
export function nextSearchSaid(previous: PeopleSearchSaid, list: PeopleListView | null): PeopleSearchSaid {
  if (list === null || list.search === 'none') return NOTHING_SAID_OF_SEARCH;
  if (list.search === 'underWay') {
    let slowAt = previous.slowAt === list.searchedFor ? previous.slowAt : null;
    return {
      said: previous.said === 'searching' || slowAt !== null ? 'searching' : 'nothing',
      slowAt,
    };
  }
  let peopleFound = list.rows.filter(({ kind }) => kind === 'person').length;
  return {
    said: previous.said === 'searching' ? peopleFound : previous.said,
    slowAt: null,
  };
}
export function peopleListAnnouncement(list: PeopleListView, said: SaidOfSearch): string | null {
  if (said === 'searching') return peoplePickerMessages.searching();
  return peopleListNote(list) ?? (said === 'nothing' ? null : peoplePickerMessages.found(said));
}
export function PeopleListAnnouncer({ list }: PeopleListAnnouncerProps) {
  let [announced, setAnnounced] = React.useState(NOTHING_SAID_OF_SEARCH);
  let next = nextSearchSaid(announced, list);
  if (next.said !== announced.said || next.slowAt !== announced.slowAt) setAnnounced(next);
  let searchUnderWayFor = list?.search === 'underWay' ? list.searchedFor : null;
  React.useEffect(() => {
    if (searchUnderWayFor === null) return;
    let timer = setTimeout(
      () => setAnnounced((current) => withSearchSlowAt(current, searchUnderWayFor)),
      PEOPLE_SEARCH_SLOW_MS,
    );
    return () => clearTimeout(timer);
  }, [searchUnderWayFor]);
  return <LiveAnnouncer words={list !== null && peopleListAnnouncement(list, next.said)} />;
}
export const PEOPLE_SEARCH_SLOW_MS = 1000;
export const NOTHING_SAID_OF_SEARCH: PeopleSearchSaid = {
  said: 'nothing',
  slowAt: null,
};
export const withSearchSlowAt = (announced: PeopleSearchSaid, slowAt: string): PeopleSearchSaid => ({
  ...announced,
  slowAt,
});
