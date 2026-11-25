import type { WorkbookReads } from '../model/workbook.ts';
import type { TimeOfDay } from '../state/initial-state.ts';
/** Morning or afternoon, as typed after a time: `a` or `p`. */
export type HalfOfDay = 'a' | 'p';
/** A time of day a fraction of a day comes to, and whether it comes to it to the second. */
export interface TimeOfDayInFraction {
  time: TimeOfDay;
  isExact: boolean;
}
export function timeOfDayFraction(dayFraction: number): TimeOfDayInFraction | null {
  let seconds = Math.round(dayFraction * 86400);
  let roundedFraction = seconds / 86400;
  if (seconds < 0 || seconds >= 86400) return null;
  if (Math.abs(roundedFraction - dayFraction) > 0.000000001) return null;
  return {
    time: timeOfSeconds(seconds),
    isExact: roundedFraction === dayFraction,
  };
}
export function minuteChoicesOf(digits: string, choicesIfNone: number[]): number[] {
  if (digits === '') return choicesIfNone;
  let number = Number(digits);
  if (digits.length === 1) return number < 6 ? [number * 10, number * 10 + 5] : [];
  return number < 60 ? [number] : [];
}
export function hourChoicesOf(hour: number, halfOfDay: HalfOfDay | null): number[] {
  if (hour > 23) return [];
  if (hour === 0 || hour > 12) return halfOfDay === null ? [hour] : [];
  if (halfOfDay !== null) return [(hour % 12) + (halfOfDay === 'p' ? 12 : 0)];
  return hour === 12 ? [12, 0] : [hour, hour + 12];
}
export function hourMinuteSplitsOf(digits: string, hasHalfOfDay: boolean): [hourDigits: string, minuteDigits: string][] {
  let splitAt = (at: number): [string, string] => [digits.slice(0, at), digits.slice(at)];
  if (digits.length === 1) return [splitAt(1)];
  if (digits.length === 4) return [splitAt(2)];
  if (digits.length === 2) return [splitAt(Number(digits[0]) > 2 && !hasHalfOfDay ? 1 : 2)];
  return hasHalfOfDay ? [splitAt(1)] : [splitAt(1), splitAt(2)];
}
export function timesTypedAs(text: string, most: number): TimeOfDay[] {
  let match = typedTimePattern.exec(text.trim());
  if (match === null) return [];
  let [, digits, hourText = '', minuteText = '', secondText = '', halfOfDayText] = match;
  let halfOfDay: HalfOfDay | null = halfOfDayText === undefined ? null : halfOfDayText.toLowerCase() === 'p' ? 'p' : 'a';
  let times = (digits === undefined ? [[hourText, minuteText] satisfies [string, string]] : hourMinuteSplitsOf(digits, halfOfDay !== null)).flatMap(
    ([hourDigits, minuteDigits]) =>
      hourChoicesOf(Number(hourDigits), halfOfDay).flatMap(
        (hour) =>
          minuteChoicesOf(minuteDigits, QUARTER_HOUR_MINUTES).flatMap(
            (minute) =>
              minuteChoicesOf(secondText, [0])
                .slice(0, 1)
                .map(
                  (second): TimeOfDay => ({
                    hour,
                    minute,
                    second,
                  }),
                ),
          ),
      ),
  );
  let timeKeys = times.map(secondsOfTime);
  return times.filter((time, index) => timeKeys.indexOf(secondsOfTime(time)) === index).slice(0, most);
}
export const secondsOfTime = ({ hour, minute, second }: TimeOfDay): number => hour * 3600 + minute * 60 + second;
export const timeOfSeconds = (seconds: number): TimeOfDay => ({
  hour: Math.floor(seconds / 3600),
  minute: Math.floor(seconds / 60) % 60,
  second: seconds % 60,
});
export const dayFractionOfTime = (time: TimeOfDay): number => secondsOfTime(time) / 86400;
export const shownTimeIn = (reads: WorkbookReads, time: TimeOfDay, pattern: string): string =>
  reads.shownWithRoomForAll(
    {
      kind: 'number',
      value: dayFractionOfTime(time),
    },
    pattern,
  ) ?? '';
export const isTwelveHourPattern = (pattern: string): boolean => /AM\/PM|A\/P/i.test(pattern);
export const shownTimeFor = (reads: WorkbookReads, time: TimeOfDay, pattern: string): string | null =>
  reads.shownWithRoomForAll(
    {
      kind: 'number',
      value: dayFractionOfTime(time),
    },
    `h:mm${time.second === 0 ? '' : ':ss'}${isTwelveHourPattern(pattern) ? ' AM/PM' : ''}`,
  );
export const typedTimePattern = /^(?:(\d{1,4})|(\d{1,2}):(\d{0,2})(?::(\d{0,2}))?)\s*(?:([ap])\.?m?\.?)?$/i;
export const QUARTER_HOUR_MINUTES = [0, 15, 30, 45];
export const timeTypedAs = (text: string): TimeOfDay | null => timesTypedAs(text, 1)[0] ?? null;
export const timesFrom = (start: TimeOfDay, stepMinutes: number, count: number): TimeOfDay[] =>
  Array.from(
    {
      length: count,
    },
    (_, index) => timeOfSeconds((secondsOfTime(start) + index * stepMinutes * 60) % 86400),
  );
