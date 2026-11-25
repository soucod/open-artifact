import { DateInput, type DateInputProps } from '../kit/date-input.tsx';
import { UiRoot } from '../kit/theme.tsx';
import * as React from 'react';
import { MESSAGE_LOCALE } from '../i18n/messages.ts';
/** The locale of the host, and how it writes 15 March 2026 in numbers. */
export interface DateInputLocale {
  locale: string;
  march15: string;
}
export function dateOrderOf(formatted: string): string | null {
  let numbers = [...formatted.matchAll(/\d+/g)].map(([digits]) => Number(digits));
  let partOfNumber = new Map([
    [15, 'day'],
    [3, 'month'],
    [2026, 'year'],
  ]);
  let parts = numbers.map((number) => partOfNumber.get(number));
  return new Set(parts).size === 3 && !parts.includes(undefined) ? parts.join(' ') : null;
}
export function regionOfLocale(locale: string): string | undefined {
  try {
    return new Intl.Locale(locale).region;
  } catch {
    return;
  }
}
export function dateInputLocaleFor({ locale, march15 }: DateInputLocale, formatMarch15: (locale: string) => string = march15In): string {
  let dateOrder = dateOrderOf(march15);
  if (dateOrder === null) return MESSAGE_LOCALE;
  let region = regionOfLocale(locale);
  return (
    [...(region === undefined ? [] : [`en-${region}`]), MESSAGE_LOCALE, 'en-GB', 'en-SE', 'en-CA', 'en-ZA'].find(
      (candidate) => dateOrderOf(formatMarch15(candidate)) === dateOrder,
    ) ?? MESSAGE_LOCALE
  );
}
export function SheetDateInput(props: DateInputProps) {
  let localeOfHost = React.use(DateInputLocaleContext);
  let locale = React.useMemo(() => dateInputLocaleFor(localeOfHost), [localeOfHost]);
  return <UiRoot locale={locale} className="contents"><DateInput {...props} /></UiRoot>;
}
export const DateInputLocaleContext = React.createContext<DateInputLocale>({
  locale: MESSAGE_LOCALE,
  march15: '3/15/2026',
});
export const march15In = (locale: string): string =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(Date.UTC(2026, 2, 15));
