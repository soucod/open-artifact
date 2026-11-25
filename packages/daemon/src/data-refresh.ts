/**
 * Live data of published Data dashboards: the snapshot the owner's computer pushes to the host.
 *
 * The rule. Connectors run only on the owner's computer, so a dashboard published to a cloud host shows the answers
 * this daemon took for it: it runs the dashboard's live queries here (the type server's `open-artifact.data.refresh`,
 * through the owner's own connectors, at the dashboard's stored filters) and Link pushes the answers as saved rows
 * (`db/data/live.json`, `db/data/live/answers/<dataset>.json`), which every page on the host replays with "Data as of
 * <time>, from <owner>'s computer". It refreshes a dashboard when it is published, when someone asks (the local Share
 * panel's "Refresh now", or a page on the host, which sends a `data-refresh` Link event), and on a timer while it is
 * linked: every `settings.cloud.dataRefresh` minutes, 360 (6 hours) by default, `0` for never. The default is
 * conservative because each refresh runs every live query of every published dashboard on the owner's warehouse,
 * which most bill per query, and the owner's computer may be asleep anyway; the timer is a safety net, and people who
 * need newer figures press Refresh. It never refreshes an artifact that is not published, nor a dashboard whose owner
 * has not confirmed that its data goes with it (`ArtifactRecord.dataPublish`, kept in the daemon's record of the
 * artifact, `~/.open-artifact/artifacts/<id>.json`): only the person's own word confirms it: publishing from the Share
 * panel (which says so, and sends `artifacts.publish {data: true}`), its "Publish its data", or a yes to the question
 * `open-artifact publish` asks at a terminal (`artifacts.data {publish: true}`). A publish through the route without
 * that flag, an automatic publish and an agent's do not, so such a dashboard is published without rows until the
 * person confirms once. Taking the confirmation back ("Stop publishing data") removes the snapshot and the dashboard
 * stays published; unpublishing removes it too and forgets the confirmation, so publishing again asks again. A failed refresh keeps
 * the last answers and records why (`data/live.failed`, shown to the owner only); a query whose answer is over the
 * 256 KB document limit fails by name and is never cut. A dataset with `"snapshot": false` stays on this computer.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_DATA_REFRESH_MINUTES, type ArtifactRecord, type DataRefreshResult, type OpenArtifactSettings } from '@open-artifact/protocol';
import type { ArtifactStore } from './store.ts';

/** The Data type's id. */
export const DATA_TYPE = 'data';

/** How often the timer looks for dashboards due a refresh, ms (`OPEN_ARTIFACT_DATA_TICK_MS`). */
const TICK_MS = 60_000;

/** Options of {@link DataRefresher}. */
export interface DataRefresherOptions {
  store: ArtifactStore;
  settings: () => OpenArtifactSettings;
  /** Runs `open-artifact.data.refresh` on the artifact's working copy (its local type server). */
  run: (record: ArtifactRecord, args: { owner?: string; queries?: string[]; clear?: boolean }) => Promise<DataRefreshResult>;
  /** Pushes the working copy to its host now (Link's sync); resolves when it is done or has failed. */
  sync: (id: string) => Promise<void>;
  /** The owner's name as the host knows them (the signed-in Link account), for "from <owner>'s computer". */
  owner: (record: ArtifactRecord) => string;
  log: (line: string) => void;
  now?: () => number;
}

/** How a dashboard's snapshot stands, as the Share panel and `artifacts.data` show it. */
export interface DataPublishStatus {
  id: string;
  /** A Data dashboard with at least one live query the snapshot would hold. */
  live: boolean;
  /** Dataset ids of those queries. */
  queries: string[];
  /** The person confirmed that its data is published with it. */
  publish: boolean;
  /** It is published to a host. */
  published: boolean;
  /** When the newest answers were taken (ISO), from `data/live`. */
  at: string | null;
  /** Why the last refresh failed, or `null`. */
  lastError: string | null;
  /** A refresh is running. */
  running: boolean;
  /** The timer's interval in minutes (`0`: no timer). */
  every: number;
}

/** Whether the working copy holds a snapshot (its status document or any answer). */
export function hasSnapshot(root: string): boolean {
  return existsSync(join(root, 'db', 'data', 'live.json')) || existsSync(join(root, 'db', 'data', 'live', 'answers'));
}

interface State {
  running: Promise<DataRefreshResult | null> | null;
  /** Asked again while running: all queries (`null`) or these. */
  again: Set<string> | null | undefined;
  lastAt: number;
  lastError: string | null;
}

const message = (error: unknown): string => (error as Error)?.message ?? String(error);

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The dataset ids of a dashboard folder's live queries the snapshot would hold: `db/datasets/<id>.json` whose source
 * is a connector call (`kind` `call`, or the older `query`) and not kept local (`"snapshot": false`). Read from the
 * files as they are (the daemon does not parse the Data model; the type server's refresh does).
 */
export function liveQueryIds(root: string): string[] {
  let names: string[];
  try {
    names = readdirSync(join(root, 'db', 'datasets'));
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const name of names.sort()) {
    if (!name.endsWith('.json')) continue;
    const doc = readJson(join(root, 'db', 'datasets', name));
    if (!isObject(doc) || doc.snapshot === false || !isObject(doc.source)) continue;
    if (doc.source.kind === 'call' || doc.source.kind === 'query') ids.push(name.slice(0, -5));
  }
  return ids;
}

/** `data/live` as the working copy holds it: when the answers were taken and why the last refresh failed. */
export function snapshotStatusOf(root: string): { at: string | null; failed: string | null } {
  const doc = readJson(join(root, 'db', 'data', 'live.json'));
  if (!isObject(doc)) return { at: null, failed: null };
  const failed = isObject(doc.failed) && typeof doc.failed.reason === 'string' ? doc.failed.reason : null;
  return { at: typeof doc.at === 'string' && doc.at ? doc.at : null, failed };
}

/** The timer's interval in minutes: `settings.cloud.dataRefresh`, else the default; `0` is no timer. */
export function refreshMinutes(settings: OpenArtifactSettings): number {
  const value = settings.cloud?.dataRefresh;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : DEFAULT_DATA_REFRESH_MINUTES;
}

/** Runs published dashboards' live queries on this computer for their hosts (see the module comment). */
export class DataRefresher {
  private readonly o: DataRefresherOptions;
  private readonly states = new Map<string, State>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(options: DataRefresherOptions) {
    this.o = options;
  }

  private now(): number {
    return this.o.now?.() ?? Date.now();
  }

  private state(id: string): State {
    let state = this.states.get(id);
    if (!state) {
      const record = this.o.store.get(id);
      const at = record ? snapshotStatusOf(record.root).at : null;
      this.states.set(id, (state = { running: null, again: undefined, lastAt: at ? Date.parse(at) || 0 : 0, lastError: null }));
    }
    return state;
  }

  /** Whether the daemon may refresh this artifact for its host: a published Data dashboard whose data the person confirmed. */
  eligible(record: ArtifactRecord | null): boolean {
    return !!record && record.type === DATA_TYPE && !!record.remote && record.dataPublish === true;
  }

  /** Starts the timer (`OPEN_ARTIFACT_DATA_TICK_MS` sets how often it looks, for tests). */
  start(): void {
    if (this.timer || this.closed) return;
    const raw = Number(process.env.OPEN_ARTIFACT_DATA_TICK_MS);
    const every = process.env.OPEN_ARTIFACT_DATA_TICK_MS && Number.isFinite(raw) && raw > 0 ? raw : TICK_MS;
    this.timer = setInterval(() => void this.tick(), every);
    this.timer.unref?.();
  }

  close(): void {
    this.closed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The timer's look: refreshes every eligible dashboard whose answers are older than the interval. */
  async tick(): Promise<string[]> {
    const minutes = refreshMinutes(this.o.settings());
    if (minutes <= 0 || this.closed) return [];
    const due: string[] = [];
    for (const record of this.o.store.list()) {
      if (!this.eligible(record) || !liveQueryIds(record.root).length) continue;
      const state = this.state(record.id);
      if (state.running || this.now() - state.lastAt < minutes * 60_000) continue;
      due.push(record.id);
    }
    await Promise.all(due.map((id) => this.refresh(id, { reason: 'timer' })));
    return due;
  }

  /**
   * Refreshes a dashboard's snapshot now: runs its live queries (`queries`, else all) here and pushes the answers.
   * `null` when it may not be refreshed (not published, not a dashboard, data not confirmed) or has no live query.
   * One at a time per dashboard: asked again while running, it runs once more after. Never throws.
   */
  refresh(id: string, options: { queries?: string[]; reason?: string } = {}): Promise<DataRefreshResult | null> {
    const record = this.o.store.get(id);
    if (this.closed || !record || !this.eligible(record)) {
      if (record?.type === DATA_TYPE) this.o.log(`data: ${id}: not refreshed (${options.reason ?? 'asked'}): ${record.remote ? 'its data is not confirmed for publishing' : 'it is not published'}`);
      return Promise.resolve(null);
    }
    const state = this.state(id);
    if (state.running) {
      if (state.again !== null) state.again = options.queries ? new Set([...(state.again ?? []), ...options.queries]) : null;
      return state.running;
    }
    state.running = this.runOnce(record, options.queries, options.reason ?? 'asked').finally(() => {
      state.running = null;
      const again = state.again;
      state.again = undefined;
      if (again !== undefined) void this.refresh(id, { ...(again ? { queries: [...again] } : {}), reason: 'asked again' });
    });
    return state.running;
  }

  private async runOnce(record: ArtifactRecord, queries: string[] | undefined, reason: string): Promise<DataRefreshResult | null> {
    const state = this.state(record.id);
    if (!liveQueryIds(record.root).length) return null;
    try {
      const result = await this.o.run(record, { owner: this.o.owner(record), ...(queries?.length ? { queries } : {}) });
      state.lastAt = this.now();
      state.lastError = result.failed.length ? result.failed.map((f) => f.reason).join(' ') : null;
      this.o.log(`data: ${record.id}: refreshed (${reason}): ${result.refreshed.length} quer${result.refreshed.length === 1 ? 'y' : 'ies'}${result.failed.length ? `, ${result.failed.length} failed: ${state.lastError}` : ''}`);
      await this.o.sync(record.id).catch(() => undefined);
      return result;
    } catch (error) {
      // The type server could not run it at all: the snapshot on the host stays as it was. Tried again by the timer.
      state.lastAt = this.now();
      state.lastError = message(error);
      this.o.log(`data: ${record.id}: refresh (${reason}) failed: ${state.lastError}`);
      return null;
    }
  }

  /** It was just published: refreshes it when its data is confirmed. */
  published(id: string): void {
    void this.refresh(id, { reason: 'published' });
  }

  /**
   * The person confirmed (`true`) or took back (`false`) publishing the dashboard's data. Confirming refreshes it when
   * published; taking it back removes the snapshot (and the host's copy with the next sync).
   */
  async confirm(id: string, on: boolean): Promise<ArtifactRecord> {
    const record = this.o.store.get(id);
    if (!record) throw new Error(`No artifact ${id}.`);
    const next = this.o.store.update(id, { dataPublish: on, updatedAt: record.updatedAt });
    if (on) {
      if (next.remote) await this.refresh(id, { reason: 'confirmed' });
    } else await this.clear(next);
    return this.o.store.get(id) ?? next;
  }

  /** It was taken off its host: the confirmation goes with it (a later publish asks again), and so does the snapshot. */
  async unpublished(record: ArtifactRecord): Promise<void> {
    const next = record.dataPublish === true ? this.o.store.update(record.id, { dataPublish: false, updatedAt: record.updatedAt }) : record;
    await this.clear(next);
  }

  /** Removes the snapshot from the working copy (and so from the host, when it is still linked). */
  async clear(record: ArtifactRecord): Promise<void> {
    if (record.type !== DATA_TYPE || !hasSnapshot(record.root)) return;
    try {
      await this.o.run(record, { clear: true });
      if (record.remote) await this.o.sync(record.id).catch(() => undefined);
    } catch (error) {
      this.o.log(`data: ${record.id}: could not remove the snapshot: ${message(error)}`);
    }
    const state = this.states.get(record.id);
    if (state) state.lastAt = 0;
  }

  /** How the dashboard's snapshot stands. */
  status(id: string): DataPublishStatus {
    const record = this.o.store.get(id);
    if (!record) throw new Error(`No artifact ${id}.`);
    const queries = record.type === DATA_TYPE ? liveQueryIds(record.root) : [];
    const disk = snapshotStatusOf(record.root);
    const state = this.states.get(id);
    return {
      id,
      live: queries.length > 0,
      queries,
      publish: record.dataPublish === true,
      published: !!record.remote,
      at: disk.at,
      lastError: state?.lastError ?? disk.failed,
      running: !!state?.running,
      every: refreshMinutes(this.o.settings()),
    };
  }
}
