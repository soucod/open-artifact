/** The find bar's "Other tabs" row: which of the doc's other tabs have matches, and a list that opens one. */
import { ChromeMenu, ChromeMenuItem, ChromeMenuLabel, ChromeMenuSeparator } from '@open-artifact/editor-kit/react';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import { CallDenied, docClient } from '../app/doc-client.ts';
import { showTab } from '../app/start.ts';
import { usePeopleNames } from '../app/people.ts';
import { orderedTabs, useDocs } from '../app/store.ts';
import { CountCache, type TabCount, type TabToCount, afterOpen, chipNamesKey, countTabs } from './other-tabs.ts';
import { setFindBar } from './store.ts';

/** How long the words rest before the other tabs are asked. */
const SETTLE_MS = 400;

interface NamedTab extends TabToCount {
  name: string;
}

export interface OtherTabsView {
  shown: boolean;
  rows: Array<{ id: string; name: string; hits: number }>;
  searching: boolean;
  /** Tabs past the limit, not asked. */
  skipped: number;
  /** Tabs the server gave no count for. */
  failed: number;
}

/** How this page writes dates, so the server reads date chips as they show here. */
function dateStyle(): { locale: string; timeZone: string } {
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  return { locale, timeZone };
}

async function serverCount(tab: TabToCount, query: string, caseSensitive: boolean): Promise<number | null> {
  try {
    const answer = await docClient().call({ member: { verb: 'read', ref: { object: 'node', id: tab.node }, payload: { kind: 'search', text: query, caseSensitive, dates: dateStyle() } } });
    return typeof answer.hits === 'number' && Number.isInteger(answer.hits) && answer.hits >= 0 ? answer.hits : null;
  } catch (error) {
    if (error instanceof CallDenied) return null;
    throw error;
  }
}

export function useOtherTabs(open: boolean, query: string, caseSensitive: boolean): OtherTabsView {
  const files = useDocs(state => state.project?.files);
  const activeTab = useDocs(state => state.activeTab);
  const [cache] = useState(() => new CountCache());
  const [counts, setCounts] = useState<ReadonlyMap<string, TabCount>>(() => new Map());
  const left = useRef(activeTab);
  const people = usePeopleNames(state => state.names);
  const chipNames = useDocs(state => chipNamesKey(state.project, people));
  const chipNamesCounted = useRef(chipNames);

  const tabs = useMemo<NamedTab[]>(() => orderedTabs(files ?? []).map(file => ({ id: file.id, node: file.content.id, rev: file.rev, name: file.name })), [files]);
  const others = useMemo(() => afterOpen(tabs, activeTab), [tabs, activeTab]);

  useEffect(() => {
    // The tab just left may have been edited here since the server last counted it.
    if (left.current && left.current !== activeTab) cache.forget(left.current);
    left.current = activeTab;
  }, [activeTab, cache]);

  useEffect(() => {
    // An option, a tab or a person renamed: every tab's chips may read differently, though no tab's revision moved.
    if (chipNamesCounted.current === chipNames) return;
    chipNamesCounted.current = chipNames;
    cache.clear();
  }, [chipNames, cache]);

  useEffect(() => {
    if (!open || !query || !others.length) {
      setCounts(new Map());
      return undefined;
    }
    setCounts(new Map(others.map(tab => [tab.id, cache.get(tab, query, caseSensitive) ?? 'pending'] as const)));
    let stop = () => undefined as void;
    const timer = setTimeout(() => {
      stop = countTabs({
        tabs: others,
        query,
        caseSensitive,
        cache,
        count: tab => serverCount(tab, query, caseSensitive),
        onCount: (id, count) => setCounts(before => new Map(before).set(id, count)),
        onEnd: () => undefined,
      });
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [open, query, caseSensitive, others, cache, chipNames]);

  return useMemo(() => {
    const unsearchedBy = { skipped: 0, failed: 0 };
    const rows: OtherTabsView['rows'] = [];
    let searching = false;
    for (const tab of tabs) {
      if (tab.id === activeTab) continue;
      const count = counts.get(tab.id);
      if (count === 'pending') searching = true;
      else if (count === 'skipped' || count === 'failed') unsearchedBy[count]++;
      else if (typeof count === 'number' && count > 0) rows.push({ id: tab.id, name: tab.name, hits: count });
    }
    return { shown: open && query !== '' && others.length > 0, rows, searching, ...unsearchedBy };
  }, [tabs, activeTab, counts, open, query, others.length]);
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The tabs without a count, said as why: "2 tabs could not be searched", "60 tabs not searched". */
function unsearched(view: OtherTabsView): string | null {
  const parts = [view.failed > 0 ? `${plural(view.failed, 'tab', 'tabs')} could not be searched` : '', view.skipped > 0 ? `${plural(view.skipped, 'tab', 'tabs')} not searched` : ''].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Puts the keyboard in `field`, again while a closing menu would hand it back to its button. */
function keepFocus(field: RefObject<HTMLInputElement | null>, ms = 400): void {
  const until = performance.now() + ms;
  const hold = () => {
    if (field.current && document.activeElement !== field.current) field.current.focus();
    if (performance.now() < until) requestAnimationFrame(hold);
  };
  hold();
}

/** Opens a tab from the list: its first match is shown, and the find field keeps the keyboard. */
function jumpTo(tab: string, findField: RefObject<HTMLInputElement | null>): void {
  setFindBar({ firstOnOpen: true });
  showTab(tab);
  keepFocus(findField);
}

export function OtherTabsRow({ view, findField }: { view: OtherTabsView; findField: RefObject<HTMLInputElement | null> }): ReactNode {
  const [listed, setListed] = useState<OtherTabsView['rows'] | null>(null);
  const rows = listed ?? view.rows;
  if (!rows.length) {
    const note = view.searching ? 'Searching other tabs…' : (unsearched(view) ?? 'No matches in other tabs');
    return (
      <span className="min-w-0 truncate text-[12px] text-chrome-muted" aria-live="polite">
        {note}
      </span>
    );
  }
  return (
    <ChromeMenu
      onOpenChange={open => setListed(open ? view.rows : null)}
      className="max-h-[min(20rem,60vh)] overflow-y-auto"
      trigger={
        <button
          type="button"
          aria-label={plural(rows.length, 'tab with matches', 'tabs with matches')}
          className="inline-flex h-7 items-center gap-1 rounded-[8px] px-2 text-[13px] text-chrome-fg ring-1 ring-chrome-line hover:bg-chrome-hover"
        >
          {plural(rows.length, 'tab', 'tabs')}
          <ChevronDown className="size-3.5 text-chrome-muted" strokeWidth={1.5} />
        </button>
      }
    >
      {rows.map(row => (
        <ChromeMenuItem key={row.id} shortcut={String(row.hits)} title={`${row.name}, ${plural(row.hits, 'match', 'matches')}`} onSelect={() => jumpTo(row.id, findField)}>
          {row.name}
        </ChromeMenuItem>
      ))}
      {unsearched(view) ? (
        <>
          <ChromeMenuSeparator />
          <ChromeMenuLabel>{unsearched(view)}</ChromeMenuLabel>
        </>
      ) : null}
    </ChromeMenu>
  );
}
