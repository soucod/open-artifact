import * as React from 'react';
/** What a live region says: words to say (none when `false`, `null` or empty), and how many times they were said before, so the same words can be said again. */
export interface LiveAnnouncerProps {
  words?: string | false | null;
  timesSaid?: number;
}
/** Words said in the live region, with the key that tells one saying from the next. */
export interface Saying {
  id: number;
  sayingKey: string;
  words: string;
}
/** The words the live region says now, those said just before (kept a moment so they are not cut off), and how many sayings there have been. */
export interface Sayings {
  now: Saying | null;
  before: Saying | null;
  count: number;
}
export function nextSayings(sayings: Sayings, { words, timesSaid = 0 }: LiveAnnouncerProps): Sayings {
  let saying =
    typeof words === 'string' && words !== ''
      ? {
          sayingKey: `${timesSaid} ${words}`,
          words,
        }
      : null;
  if ((sayings.now?.sayingKey ?? null) === (saying?.sayingKey ?? null)) return sayings;
  let count = sayings.count + 1;
  return {
    now:
      saying === null
        ? null
        : {
            id: count,
            ...saying,
          },
    before: sayings.now ?? sayings.before,
    count,
  };
}
export function LiveAnnouncer(announcement: LiveAnnouncerProps) {
  let [sayings, setSayings] = React.useState(() => nextSayings(NO_SAYINGS, announcement));
  let sayingsNow = nextSayings(sayings, announcement);
  if (sayingsNow !== sayings) setSayings(sayingsNow);
  let beforeId = sayings.before?.id;
  React.useEffect(() => {
    if (beforeId === undefined) return;
    let timeoutId = setTimeout(
      () =>
        setSayings(
          (current) =>
            current.before?.id === beforeId
              ? {
                  ...current,
                  before: null,
                }
              : current,
        ),
      OLD_SAYING_KEEP_MS,
    );
    return () => clearTimeout(timeoutId);
  }, [beforeId]);
  return <div role="status" aria-live="polite" aria-atomic="false" className="sr-only">{[sayingsNow.before, sayingsNow.now].map(
      (saying) =>
        saying !== null &&
        <p key={saying.id}>{saying.words}</p>,
    )}</div>;
}
export const OLD_SAYING_KEEP_MS = 1000;
export const NO_SAYINGS: Sayings = {
  now: null,
  before: null,
  count: 0,
};
