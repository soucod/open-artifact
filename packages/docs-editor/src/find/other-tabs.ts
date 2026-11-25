/**
 * How many matches the doc's other tabs have, asked of the server one tab at a time (the tabs after the open one
 * first), and remembered per tab revision so a tab is asked again only when it changed. A dropdown option, a tab or a
 * person renamed changes what chips say without changing any tab's revision, so then every count is asked again.
 */

export interface TabToCount {
  id: string;
  /** The tab's body node, which the server's search reads. */
  node: string;
  rev: number;
}

/** A tab's count: a number, still being asked, not asked (past the limit), or asked without an answer. */
export type TabCount = number | 'pending' | 'skipped' | 'failed';

/** At most this many tabs are asked per search; the rest are "not searched". */
export const MAX_TABS_SEARCHED = 50;

/** The other tabs, starting after `open` and wrapping round. */
export function afterOpen<T extends { id: string }>(tabs: readonly T[], open: string | null): T[] {
  const index = tabs.findIndex(tab => tab.id === open);
  if (index < 0) return [...tabs];
  return [...tabs.slice(index + 1), ...tabs.slice(0, index)];
}

/** What the doc's chips can show that is not in any tab's text: its dropdown options and tab names (and people's names). */
export interface ChipNamesSource {
  enums?: ReadonlyArray<{ id: string; options: ReadonlyArray<{ name: string }> }>;
  files?: ReadonlyArray<{ id: string; name: string }>;
}

/** A key that changes whenever an option, a tab or a person (`people`: id → name) is renamed, added or removed. */
export function chipNamesKey(project: ChipNamesSource | null | undefined, people: Readonly<Record<string, string>> = {}): string {
  const named = Object.entries(people).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!project && !named.length) return '';
  return JSON.stringify([(project?.enums ?? []).map(list => [list.id, list.options.map(option => option.name)]), (project?.files ?? []).map(file => [file.id, file.name]), named]);
}

export class CountCache {
  private readonly counts = new Map<string, { rev: number; hits: number }>();

  private static key(tab: string, query: string, caseSensitive: boolean): string {
    return `${tab}\u0000${caseSensitive ? 1 : 0}\u0000${query}`;
  }

  get(tab: TabToCount, query: string, caseSensitive: boolean): number | undefined {
    const known = this.counts.get(CountCache.key(tab.id, query, caseSensitive));
    return known && known.rev === tab.rev ? known.hits : undefined;
  }

  set(tab: TabToCount, query: string, caseSensitive: boolean, hits: number): void {
    if (this.counts.size >= 256) this.counts.clear();
    this.counts.set(CountCache.key(tab.id, query, caseSensitive), { rev: tab.rev, hits });
  }

  /** Forgets every count. */
  clear(): void {
    this.counts.clear();
  }

  /** Forgets a tab's counts (it was open and edited). */
  forget(tab: string): void {
    for (const key of this.counts.keys()) if (key.startsWith(`${tab}\u0000`)) this.counts.delete(key);
  }
}

export interface CountJob {
  tabs: readonly TabToCount[];
  query: string;
  caseSensitive: boolean;
  cache: CountCache;
  /** The server's count for one tab; null when it gave none. Rejects when it could not be asked. */
  count(tab: TabToCount): Promise<number | null>;
  onCount(tab: string, count: TabCount): void;
  onEnd(): void;
}

/** Counts the tabs one after another; the returned function stops it. */
export function countTabs(job: CountJob): () => void {
  let stopped = false;
  const queue: TabToCount[] = [];
  for (const tab of job.tabs) {
    const known = job.cache.get(tab, job.query, job.caseSensitive);
    if (known !== undefined) job.onCount(tab.id, known);
    else if (queue.length >= MAX_TABS_SEARCHED) job.onCount(tab.id, 'skipped');
    else {
      job.onCount(tab.id, 'pending');
      queue.push(tab);
    }
  }
  void (async () => {
    for (let index = 0; index < queue.length; index++) {
      const tab = queue[index]!;
      let hits: number | null;
      try {
        hits = await job.count(tab);
      } catch {
        if (stopped) return;
        for (const rest of queue.slice(index)) job.onCount(rest.id, 'failed');
        break;
      }
      if (stopped) return;
      if (hits === null) job.onCount(tab.id, 'failed');
      else {
        job.cache.set(tab, job.query, job.caseSensitive, hits);
        job.onCount(tab.id, hits);
      }
    }
    if (!stopped) job.onEnd();
  })();
  return () => {
    stopped = true;
  };
}
