/**
 * The words a chip shows in the editor (a date, a dropdown's option, a person, a tab), worked out the same way on the
 * page and on the server, so the find bar's count for the open tab and the server's count for the others agree.
 */

/** How a viewer's page writes dates: its locale and time zone (the running system's when left out). */
export interface DateStyle {
  locale?: string;
  timeZone?: string;
}

/** What a chip names, looked up in the doc. Null when it is not there. */
export interface ChipLookup {
  /** A dropdown option's name, by list id and option index. */
  option(list: string, index: number): string | null;
  /** A tab's name, by its id. */
  tab(id: string): string | null;
  /** A person's name, by the id a mention names them with. */
  person(id: string): string | null;
}

export type ChipKind = 'date' | 'dropdown' | 'mention';

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TAB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}$/;

const words = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** The tab a mention links to: `file/<id>` as an agent writes it, or the bare id the editor puts in. */
export function tabOfRef(ref: unknown): string | null {
  if (typeof ref !== 'string') return null;
  const id = ref.startsWith('file/') ? ref.slice('file/'.length) : ref;
  return TAB_ID.test(id) ? id : null;
}

/** `style` as Intl takes it: a locale or time zone it does not know is dropped. */
function usable(style: DateStyle): DateStyle {
  try {
    new Intl.DateTimeFormat(style.locale, { timeZone: style.timeZone });
    return style;
  } catch {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: style.timeZone });
      return { timeZone: style.timeZone };
    } catch {
      return {};
    }
  }
}

const yearIn = (at: Date, timeZone: string | undefined) => new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone }).format(at);

/**
 * A date chip's words: month and day, and the year when it is not the viewer's current year. A bare day
 * (`2026-11-23`) is that day in any time zone. '' when the chip holds no date.
 */
export function shownDate(ts: unknown, style: DateStyle = {}, now: Date = new Date()): string {
  if (typeof ts !== 'string' || !ts) return '';
  const bare = BARE_DATE.test(ts);
  const date = new Date(bare ? `${ts}T00:00:00Z` : ts);
  if (Number.isNaN(date.getTime())) return ts;
  const { locale, timeZone } = usable(style);
  const zone = bare ? 'UTC' : timeZone;
  const thisYear = yearIn(date, zone) === yearIn(now, timeZone);
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', ...(thisYear ? {} : { year: 'numeric' }), timeZone: zone }).format(date);
}

/**
 * The words a chip shows, or null when it shows only a placeholder (no date set, no option picked, nobody named). A
 * link to a tab reads as the tab's name now; a person as `@` and their name.
 */
export function chipText(kind: ChipKind, attrs: Readonly<Record<string, unknown>>, lookup: ChipLookup, style: DateStyle = {}): string | null {
  switch (kind) {
    case 'date':
      return shownDate(attrs.ts, style) || null;
    case 'dropdown': {
      const index = typeof attrs.index === 'number' ? attrs.index : typeof attrs.index === 'string' && attrs.index ? Number(attrs.index) : -1;
      return typeof attrs.enum === 'string' && Number.isInteger(index) && index >= 0 ? words(lookup.option(attrs.enum, index)) : null;
    }
    case 'mention': {
      const tab = tabOfRef(attrs.ref);
      if (tab) return words(lookup.tab(tab)) ?? words(attrs.label);
      const principal = typeof attrs.principal === 'string' ? attrs.principal : null;
      const name = words(attrs.label) ?? words(attrs.name) ?? (principal ? words(lookup.person(principal)) : null) ?? (principal === 'agent' ? 'agent' : words(attrs.ref));
      return name ? `@${name}` : null;
    }
  }
}

export const isChipKind = (kind: string): kind is ChipKind => kind === 'date' || kind === 'dropdown' || kind === 'mention';
