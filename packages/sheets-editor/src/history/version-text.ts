import { AGENT_NAME } from '../agent/agent-name.ts';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
import type { HistoryWhy, VersionNotTakenNotice, VersionRestoredOffer } from '../state/initial-state.ts';
import type { ShownAuthor } from './version-history.ts';

/** Why a history could not be read, in words: a title, a hint under it, and whether trying again may help. */
export interface HistoryFailureWords {
  title: string;
  hint?: string;
  canTryAgain: boolean;
}

/** Whether a time falls today or yesterday, by the calendar. Times are in milliseconds. */
export function dayOfVersion(atMs: number, nowMs: number): 'today' | 'yesterday' | null {
  let yesterday = new Date(startOfDayMs(nowMs));
  yesterday.setDate(yesterday.getDate() - 1);
  if (startOfDayMs(atMs) >= startOfDayMs(nowMs)) return 'today';
  return startOfDayMs(atMs) === yesterday.getTime() ? 'yesterday' : null;
}
export function versionTimeText(atMs: number, nowMs: number): string {
  let timeOfDay = formatTimeOfDay(atMs);
  let dayName = dayOfVersion(atMs, nowMs);
  if (dayName === 'today')
    return translateMessage(
      {
        defaultMessage: 'Today at {time}',
        id: 'TyE+acT53T',
      },
      {
        time: timeOfDay,
      },
    );
  if (dayName === 'yesterday')
    return translateMessage(
      {
        defaultMessage: 'Yesterday at {time}',
        id: 'A3m4i7/ny8',
      },
      {
        time: timeOfDay,
      },
    );
  let weekAgo = new Date(startOfDayMs(nowMs));
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (startOfDayMs(atMs) >= weekAgo.getTime())
    return translateMessage(
      {
        defaultMessage: '{weekday} at {time}',
        id: 'nsfitrZH80',
      },
      {
        weekday: new Intl.DateTimeFormat(MESSAGE_LOCALE, {
          weekday: 'long',
        }).format(atMs),
        time: timeOfDay,
      },
    );
  return translateMessage(
    {
      defaultMessage: '{date} at {time}',
      id: 'VbvjiChqJ2',
    },
    {
      date: new Intl.DateTimeFormat(
        MESSAGE_LOCALE,
        isSameCalendarYear(atMs, nowMs)
          ? {
              month: 'long',
              day: 'numeric',
            }
          : {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            },
      ).format(atMs),
      time: timeOfDay,
    },
  );
}
export function versionAuthorsText(authors: ShownAuthor[]): string {
  if (authors.map(versionAuthorName).includes('')) return '';
  let [first, second, ...others] = authors.filter(({ kind }) => kind !== 'agent').map(versionAuthorName);
  let agentAuthor = authors.find(({ kind }) => kind === 'agent');
  let otherCount = others.length;
  if (first === undefined) return agentAuthor === undefined ? '' : versionAuthorName(agentAuthor);
  if (second === undefined)
    return agentAuthor === undefined
      ? first
      : translateMessage(
          {
            defaultMessage: '{a} + {agent}',
            id: 'VaYHcOrfWb',
          },
          {
            a: first,
            agent: AGENT_NAME,
          },
        );
  if (otherCount === 0)
    return agentAuthor === undefined
      ? translateMessage(
          {
            defaultMessage: '{a}, {b}',
            id: 'esWPF/YMbc',
          },
          {
            a: first,
            b: second,
          },
        )
      : translateMessage(
          {
            defaultMessage: '{a}, {b} + {agent}',
            id: '1BOwUKtJo3',
          },
          {
            a: first,
            b: second,
            agent: AGENT_NAME,
          },
        );
  return agentAuthor === undefined
    ? translateMessage(
        {
          defaultMessage: '{n, plural, one {{a}, {b}, {n} more} other {{a}, {b}, {n} more}}',
          id: 'OM9rOxOFdv',
        },
        {
          a: first,
          b: second,
          n: otherCount,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{n, plural, one {{a}, {b}, {n} more + {agent}} other {{a}, {b}, {n} more + {agent}}}',
          id: 'yrp58sbeQZ',
        },
        {
          a: first,
          b: second,
          n: otherCount,
          agent: AGENT_NAME,
        },
      );
}
export function versionHistoryFailureText(why: HistoryWhy): HistoryFailureWords {
  switch (why) {
    case 'storeDoesNotKnowHow':
      return {
        title: translateMessage({
          defaultMessage: 'Version history isn’t available yet',
          id: 'ZUjtpfRi0I',
        }),
        hint: translateMessage({
          defaultMessage: 'Try again later.',
          id: 'rVT86auLrP',
        }),
        canTryAgain: false,
      };
    case 'recordDoesNotMatch':
      return {
        title: translateMessage({
          defaultMessage: 'Version history isn’t available for this Sheet',
          id: 'J2bqaW/vjY',
        }),
        canTryAgain: false,
      };
    case 'tookTooLong':
    case 'busy':
    case 'noAnswer':
    case 'refused':
      return {
        title: translateMessage({
          defaultMessage: 'Couldn’t load version history',
          id: 'GNf2i872TB',
        }),
        ...(why === 'noAnswer' && {
          hint: translateMessage({
            defaultMessage: 'Check your connection, then try again.',
            id: 'S0xGQgXgrN',
          }),
        }),
        canTryAgain: true,
      };
  }
}
export function versionNotRestoredText({ why }: Pick<VersionNotTakenNotice, 'why'>): string | undefined {
  switch (why) {
    case 'tooMuch':
      return translateMessage({
        defaultMessage: 'This version is too far back to restore.',
        id: 'VpqXMQ8zKB',
      });
    case 'nothingToChange':
      return translateMessage({
        defaultMessage: 'The Sheet already matches this version.',
        id: 'WnHn17Dqt/',
      });
    case 'notAccepted':
    case 'recordDoesNotMatch':
    case 'storeDoesNotKnowHow':
    case 'refused':
    case 'fault':
      return translateMessage({
        defaultMessage: 'This version can’t be restored.',
        id: 'C7nX31QFxf',
      });
    case 'tookTooLong':
      return translateMessage({
        defaultMessage: 'Restoring took too long. Try again.',
        id: 'vFkFv0K158',
      });
    case 'busy':
    case 'noAnswer':
      return translateMessage({
        defaultMessage: 'Couldn’t restore this version right now. Try again in a few minutes.',
        id: '8Gd4hg5Yqb',
      });
    case 'storeMovedOn':
      return translateMessage({
        defaultMessage: 'The Sheet changed before this version could be restored. Try again.',
        id: 'hOaQByrX92',
      });
  }
}
export function versionNotShownText({ why }: Pick<VersionNotTakenNotice, 'why'>): string | undefined {
  switch (why) {
    case 'editsNotSaved':
      return translateMessage({
        defaultMessage: 'This version can’t be shown until your latest changes are saved. Try again once they are.',
        id: 'GaIsVcbmLA',
      });
    case 'tookTooLong':
    case 'busy':
    case 'noAnswer':
      return translateMessage({
        defaultMessage: 'Couldn’t show this version right now. Try again in a few minutes.',
        id: 'ZrH6SuWjUG',
      });
    case 'recordDoesNotMatch':
    case 'storeDoesNotKnowHow':
    case 'unknownRevision':
    case 'notOffered':
    case 'refused':
      return translateMessage({
        defaultMessage: 'This version can’t be shown.',
        id: 'vdyuh1T08j',
      });
  }
}
export function versionRestoredToast(
  restored: Pick<VersionRestoredOffer, 'atMs' | 'isSaved'>,
  nowMs: number,
): { title: string; undoLabel: string } {
  let { isSaved } = restored;
  let undoLabel = translateMessage({
    defaultMessage: 'Undo restore',
    id: 'VjZlIRO33M',
  });
  let when = formatLongDateTime(restored.atMs, nowMs);
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: 'Restored the version from {when}',
            id: 'fnNVeIeZ0K',
          },
          {
            when,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Restoring the version from {when}…',
            id: 'mwbOK250TI',
          },
          {
            when,
          },
        ),
    undoLabel,
  };
}
export const startOfDayMs = (atMs: number): number => new Date(atMs).setHours(0, 0, 0, 0);
export const isSameCalendarYear = (atMs: number, nowMs: number): boolean =>
  new Date(atMs).getFullYear() === new Date(nowMs).getFullYear();
export const formatTimeOfDay = (atMs: number): string =>
  new Intl.DateTimeFormat(MESSAGE_LOCALE, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(atMs);
export const formatShortDate = (atMs: number, nowMs: number): string =>
  new Intl.DateTimeFormat(MESSAGE_LOCALE, {
    month: 'short',
    day: 'numeric',
    ...(!isSameCalendarYear(atMs, nowMs) && {
      year: 'numeric',
    }),
  }).format(atMs);
export const formatLongDateTime = (atMs: number, nowMs: number): string =>
  new Intl.DateTimeFormat(MESSAGE_LOCALE, {
    month: 'long',
    day: 'numeric',
    ...(!isSameCalendarYear(atMs, nowMs) && {
      year: 'numeric',
    }),
    hour: 'numeric',
    minute: '2-digit',
  }).format(atMs);
export const versionAuthorName = (author: ShownAuthor): string => {
  if (author.kind === 'agent') return AGENT_NAME;
  if (author.name === null) return '';
  if (author.name !== '') return author.name;
  return translateMessage({
    defaultMessage: 'Someone',
    id: 'zOTWnVXc9G',
  });
};
export const versionHistoryMessages = {
  title: () =>
    translateMessage({
      defaultMessage: 'Version history',
      id: 'a/antv1YPn',
    }),
  currentVersion: () =>
    translateMessage({
      defaultMessage: 'Current',
      id: 'iGl3a39MAY',
    }),
  restore: () =>
    translateMessage({
      defaultMessage: 'Restore this version',
      id: 'RTgaY8vlvo',
    }),
  moreActions: () =>
    translateMessage({
      defaultMessage: 'More actions',
      id: 'zOvMcAZv8e',
    }),
  backToEditing: () =>
    translateMessage({
      defaultMessage: 'Back to editing',
      id: 'KZj2R5Kuse',
    }),
  viewOnly: () =>
    translateMessage({
      defaultMessage: 'View only',
      id: 'qLYc9WJLAi',
    }),
  earlierVersionSaid: (when: string) =>
    translateMessage(
      {
        defaultMessage: '{when}, earlier version, view only',
        id: '1qbjHmTGxc',
      },
      {
        when,
      },
    ),
  currentVersionSaid: () =>
    translateMessage({
      defaultMessage: 'Showing the current version',
      id: 'eLuxiLOOib',
    }),
  openingVersion: () =>
    translateMessage({
      defaultMessage: 'Opening this version…',
      id: 'YWq32hWPLK',
    }),
  showOlderVersions: () =>
    translateMessage({
      defaultMessage: 'Show older versions',
      id: 'l6KxOeJ4c+',
    }),
  olderVersionsNotLoaded: () =>
    translateMessage({
      defaultMessage: 'Couldn’t load older versions',
      id: '/fJaQ8XFob',
    }),
  loading: () =>
    translateMessage({
      defaultMessage: 'Loading version history…',
      id: 'VgznJWBw/f',
    }),
  tryAgain: () =>
    translateMessage({
      defaultMessage: 'Try again',
      id: 'jtww9Eieby',
    }),
};
