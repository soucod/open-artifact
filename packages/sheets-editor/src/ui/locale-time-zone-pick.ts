import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { MESSAGE_LOCALE, translateMessage } from '../i18n/messages.ts';
import { sortByLabel } from '../messages/locale.ts';
import type { LocaleSetDone, PageState, PickForWorkbook, TimeZoneSetDone } from '../state/initial-state.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { Edit } from '@open-artifact/sheets-core';
import type { ComboboxOption } from '../kit/combobox.tsx';
/** The workbook setting asked to be picked; a time zone is asked with the browser's own. */
export type WorkbookSettingAsked = { of: 'locale' } | { of: 'timeZone'; nameInBrowser: string };
export function workbookSettingPick(workbook: WorkbookReads, asked: WorkbookSettingAsked): PickForWorkbook | null {
  if (asked.of === 'locale') {
    let locales = workbook.locales();
    return locales === null
      ? null
      : {
          of: 'locale',
          picked: null,
          ofWorkbook: workbook.locale,
          all: locales,
        };
  }
  let timeZones = workbook.timeZones();
  if (timeZones === null) return null;
  let browserTimeZone = workbook.timeZoneNamed(asked.nameInBrowser);
  return {
    of: 'timeZone',
    picked: null,
    ofWorkbook: workbook.timeZone,
    ofBrowser: browserTimeZone,
    all: timeZones,
  };
}
export function openWorkbookSettingPick(state: PageState, workbook: WorkbookReads, asked: WorkbookSettingAsked): PageTransition {
  let pick = workbookSettingPick(workbook, asked);
  if (pick === null) return withNoEffects(state);
  return withNoEffects({
    ...state,
    menu: null,
    customNumberFormat: null,
    lastDone: null,
    notice: null,
    pickForWorkbook: pick,
  });
}
export function pickWorkbookSetting(state: PageState, pickKind: PickForWorkbook['of'], picked: string): PageTransition {
  let pickForWorkbook = state.pickForWorkbook;
  if (pickForWorkbook?.of !== pickKind) return withNoEffects(state);
  let pickedOrNone = picked === pickForWorkbook.ofWorkbook ? null : picked;
  return withNoEffects({
    ...state,
    pickForWorkbook: {
      ...pickForWorkbook,
      picked: pickedOrNone,
    },
  });
}
export function editOfWorkbookSettingPick(pickForWorkbook: PickForWorkbook): [Edit, LocaleSetDone | TimeZoneSetDone] {
  let picked = pickedOrWorkbookSetting(pickForWorkbook);
  return pickForWorkbook.of === 'locale'
    ? [
        {
          kind: 'setLocale',
          locale: picked,
        },
        {
          what: 'localeSet',
          locale: picked,
        },
      ]
    : [
        {
          kind: 'setTimeZone',
          timeZone: picked,
        },
        {
          what: 'timeZoneSet',
          timeZone: picked,
        },
      ];
}
export function commitWorkbookSettingPick(state: PageState): PageTransition {
  let pickForWorkbook = state.pickForWorkbook;
  let closedState = {
    ...state,
    pickForWorkbook: null,
  };
  if (pickForWorkbook === null || !isWorkbookSettingChanged(pickForWorkbook)) return withNoEffects(closedState);
  let [edit, done] = editOfWorkbookSettingPick(pickForWorkbook);
  return queueEdit(closedState, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    done,
  });
}
export function syncWorkbookSettingPick(state: PageState, workbook: Pick<WorkbookReads, 'locale' | 'timeZone'>): PageState {
  let pickForWorkbook = state.pickForWorkbook;
  if (pickForWorkbook === null || pickForWorkbook.ofWorkbook === workbook[pickForWorkbook.of]) return state;
  return {
    ...state,
    pickForWorkbook:
      pickForWorkbook.of === 'locale'
        ? {
            ...pickForWorkbook,
            ofWorkbook: workbook.locale,
          }
        : {
            ...pickForWorkbook,
            ofWorkbook: workbook.timeZone,
          },
  };
}
export function longTimeZoneName(timeZone: string): string | null {
  let cached = longTimeZoneNameCache.get(timeZone);
  if (cached !== undefined) return cached;
  let longName: string | null = null;
  try {
    longName =
      new Intl.DateTimeFormat(MESSAGE_LOCALE, {
        timeZone,
        timeZoneName: 'longGeneric',
      })
        .formatToParts()
        .find(({ type }) => type === 'timeZoneName')?.value ?? null;
  } catch {
    longName = null;
  }
  longTimeZoneNameCache.set(timeZone, longName);
  return longName;
}
export function shortTimeZoneLabel(timeZone: string | null): string {
  if (timeZone === null || timeZone === UTC_TIME_ZONE)
    return translateMessage({
      defaultMessage: 'UTC',
      id: 'xRXJ04SyLm',
    });
  return longTimeZoneName(timeZone) ?? timeZone;
}
export function timeZoneLabel(timeZone: string): string {
  if (timeZone === UTC_TIME_ZONE)
    return translateMessage({
      defaultMessage: 'UTC (Coordinated Universal Time)',
      id: 'WtS6hmNlJX',
    });
  let longName = longTimeZoneName(timeZone);
  if (longName === null) return timeZone;
  if (isEtcTimeZone(timeZone)) return longName;
  return translateMessage(
    {
      defaultMessage: '{city} ({name})',
      id: 'GPxg8ZkLyv',
    },
    {
      city: cityOfTimeZone(timeZone),
      name: longName,
    },
  );
}
export function timeZoneOptions(timeZones: readonly string[], browserTimeZone: string | null, workbookTimeZone: string | null): ComboboxOption[] {
  let others = new Set([...(workbookTimeZone === null ? [] : [workbookTimeZone]), ...timeZones]);
  if (browserTimeZone === null) return sortedTimeZoneOptions(others);
  others.delete(browserTimeZone);
  let [firstOther, ...restOthers] = sortedTimeZoneOptions(others);
  return [
    {
      ...timeZoneOption(browserTimeZone),
      groupLabelBefore: timeZoneMessages.yourTimeZone(),
    },
    ...(firstOther === undefined
      ? []
      : [
          {
            ...firstOther,
            groupLabelBefore: timeZoneMessages.otherTimeZones(),
          },
        ]),
    ...restOthers,
  ];
}
export const UTC_TIME_ZONE = 'UTC';
export const isEtcTimeZone = (timeZone: string) => timeZone.startsWith('Etc/');
export const pickedOrWorkbookSetting = (pickForWorkbook: PickForWorkbook): string =>
  pickForWorkbook.picked ??
  (pickForWorkbook.of === 'locale' ? pickForWorkbook.ofWorkbook : (pickForWorkbook.ofWorkbook ?? pickForWorkbook.ofBrowser ?? UTC_TIME_ZONE));
export const isWorkbookSettingChanged = (pickForWorkbook: PickForWorkbook) =>
  pickedOrWorkbookSetting(pickForWorkbook) !== pickForWorkbook.ofWorkbook;
export const timeZoneMessages = {
  timeZone: () =>
    translateMessage({
      defaultMessage: 'Time zone',
      id: 'fQmcSvptdF',
    }),
  whatGoesByIt: () =>
    translateMessage({
      defaultMessage: 'The current date and time (NOW and TODAY) use this time zone for everyone who opens this Sheet.',
      id: 'Bpl1YrmwuK',
    }),
  yourTimeZone: () =>
    translateMessage({
      defaultMessage: 'Your time zone',
      id: 'WE+ErqhfYO',
    }),
  otherTimeZones: () =>
    translateMessage({
      defaultMessage: 'Other time zones',
      id: 'dPC9M2UHPO',
    }),
};
export const longTimeZoneNameCache = new Map<string, string | null>();
export const cityOfTimeZone = (timeZone: string) => timeZone.slice(timeZone.lastIndexOf('/') + 1).replaceAll('_', ' ');
export const timeZoneSetText = (timeZone: string) =>
  translateMessage(
    {
      defaultMessage: 'Time zone set to {timeZone}',
      id: '2dp9y+r8Nk',
    },
    {
      timeZone: timeZoneLabel(timeZone),
    },
  );
export const timeZoneOption = (timeZone: string): ComboboxOption => ({
  value: timeZone,
  label: timeZoneLabel(timeZone),
});
export const sortedTimeZoneOptions = (timeZones: Iterable<string>) => sortByLabel(Array.from(timeZones, timeZoneOption));
