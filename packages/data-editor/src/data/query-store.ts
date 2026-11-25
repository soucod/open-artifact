import {
  LIMITER_DEFAULTS,
  SYSTEM_CLOCK,
  createAdaptiveLimiter,
  getSourceConnectorSpec,
  retryWhileBusy,
  type AdaptiveLimiter,
  type ConnectionFix,
  type Dataset,
  type DatasetLoadContext,
  type DatasetLoader,
  type DatasetRun,
  type FailedRun,
  type IdleRun,
  type LimiterOutcome,
  type LoadDataset,
  type LoadResult,
  type LoadSuccess,
  type OkRun,
  type PollClock,
  type Table,
} from '@open-artifact/data-core';
import { loadDatasetFile, type FileEnvironment } from './files.ts';
import { executeDatasetQuery, type QueryEnvironment } from './queries.ts';

export const IDLE_DATASET_RUN: IdleRun = Object.freeze({ status: 'idle' }) as IdleRun;

/** After a connection failure the connector's queries are tried again on the viewer's next move, at most this often. */
export const CONNECTOR_NUDGE_INTERVAL_MS = 5000;

export interface LiveStoreOptions {
  load: LoadDataset;
  /** A fixed concurrency (start and ceiling); the adaptive defaults when left out. */
  concurrency?: number;
  /** Whether an answer for this source may be cached: a cached one is then shown while the fresh one loads. */
  mayBeCached?: (dataset: Dataset, reuseMs: number) => boolean;
  /** How old an answer may be and still be reused (the dashboard's updates setting), in ms. */
  reuse?: () => Promise<number>;
  /** The clock the limiters and busy retries wait on. */
  clock?: PollClock;
  /** Wall-clock time for run stamps. */
  now?: () => number;
}

export interface LiveDatasetStore {
  get(id: string): DatasetRun;
  version(): number;
  subscribe(listener: () => void): () => void;
  /** Starts every source whose load key changed (a new query, filter value or loader). */
  sync(datasets: Dataset[]): void;
  run(dataset: Dataset): Promise<void>;
  refresh(dataset: Dataset): void;
  refreshAll(): void;
  retryFailed(): void;
  retry(connector?: string, dataset?: Dataset): void;
  nudge(now?: number): void;
  /** How many loads are in flight. */
  pending(): number;
  /** Resolves once no load is in flight. */
  settled(): Promise<void>;
  /**
   * Shows a new answer for a source that already loaded (saved rows that changed), without a loading state; one that
   * is loading takes it once its load is done. A source never loaded, or loaded for another key, is left alone.
   */
  put(dataset: Dataset, result: LoadResult): void;
}

export function isFailedDatasetRun(run: DatasetRun): run is FailedRun {
  return run.status !== 'ok' && run.status !== 'idle' && run.status !== 'running';
}

const CONNECTION_FIX_BY_STATUS: Partial<Record<DatasetRun['status'], ConnectionFix>> = {
  connect: 'allow',
  reauth: 'reconnect',
  absent: 'add',
  unchosen: 'choose',
};

export function getConnectionFix(run: Pick<DatasetRun, 'status'>): ConnectionFix | null {
  return CONNECTION_FIX_BY_STATUS[run.status] ?? null;
}

/** "choose" (a gone connector) asks for consent like "allow". */
export function isConsentFix(fix: ConnectionFix): boolean {
  return fix === 'allow' || fix === 'choose';
}

/** A query declined because its connector is turned off for this dashboard names that connector. */
export function getTurnedOffConnector(run: DatasetRun): string | null {
  return run.status === 'declined' && run.wording?.code === 'turnedOff' ? run.wording.connector : null;
}

export function isRetryableDatasetFailure(run: DatasetRun): boolean {
  return isFailedDatasetRun(run) && run.status !== 'declined' && getConnectionFix(run) === null;
}

export function isPageCodeFailure(run: DatasetRun): boolean {
  return run.status === 'failed' && run.pageCode === true;
}

export function isTimedOutFailure(run: DatasetRun): boolean {
  return run.status === 'failed' && run.timedOut === true;
}

export function isUnansweredFailure(run: DatasetRun): boolean {
  return run.status === 'failed' && run.unanswered === true;
}

export function getLastSuccessfulRun(run: DatasetRun): OkRun | null {
  if (run.status === 'ok') return run;
  if (run.status === 'running') return run.prev === null ? (run.cached ?? null) : getLastSuccessfulRun(run.prev);
  return run.status === 'idle' ? null : (run.kept ?? null);
}

export function getRunTable(run: DatasetRun): Table | null {
  return getLastSuccessfulRun(run)?.table ?? null;
}

/** An attached file is stale once its `staleAfterHours` passed since it was added. */
export function isDatasetStale(dataset: Dataset, now: number): boolean {
  if (dataset.source.kind === 'query' || dataset.staleAfterHours === null || dataset.updated === null) return false;
  return now - dataset.updated.at > dataset.staleAfterHours * 3_600_000;
}

export function getLiveDatasetConnector(dataset: Dataset): string {
  return dataset.source.kind === 'query' ? dataset.source.connector : '';
}

/** What makes a source load again when it changes; `""` for one that doesn't load (a calculation). */
export function getDatasetLoadKey(dataset: Dataset): string {
  const source = dataset.source;
  // Saved rows load again only when they move to another path; their changes arrive by themselves.
  if (source.kind === 'store') return source.path && `store:${source.path}`;
  const loaderKey = dataset.loader === undefined ? [] : [dataset.loader.code];
  if (source.kind === 'query')
    return JSON.stringify([
      'q',
      source.connector,
      source.tool,
      source.args,
      ...(source.rules === undefined ? [] : [source.rules]),
      ...loaderKey,
      ...(source.call === true ? [true, ...(source.unfilled === undefined ? [] : [source.unfilled])] : []),
    ]);
  return source.kind === 'file' ? ['f', source.url, source.format, ...loaderKey].join('|') : '';
}

/** The datasets with the page's `dash.loader`s attached (queries and files only). */
export function attachDatasetLoaders(datasets: Dataset[], loaders: ReadonlyMap<string, DatasetLoader>): Dataset[] {
  if (loaders.size === 0) return datasets;
  return datasets.map((dataset) => {
    const loader = loaders.get(dataset.id);
    return loader === undefined || (dataset.source.kind !== 'query' && dataset.source.kind !== 'file')
      ? dataset
      : { ...dataset, loader: loader as Dataset['loader'] };
  });
}

/** Orders sources by the page's `data-fetchpriority` lists: "high" first, "low" after the rest, and those marked only under `[hidden]` last. */
export function applyFetchPriority(
  datasets: Dataset[],
  high: readonly string[] = [],
  low: readonly string[] = [],
  hidden: readonly string[] = [],
): Dataset[] {
  const rank = (dataset: Dataset): number =>
    hidden.includes(dataset.id) && !high.includes(dataset.id) ? 2 : Number(low.includes(dataset.id)) - Number(high.includes(dataset.id));
  return [...datasets].sort((first, second) => rank(first) - rank(second));
}

/** Where saved rows are read: the source's path in, its rows out. */
export interface SavedRowsEnvironment {
  savedRows?: (path: string) => Promise<LoadResult>;
}

const NO_SAVED_ROWS: LoadResult = {
  ok: false,
  kind: 'failed',
  message: 'This view has no store, so saved rows can’t be read here.',
  wording: { code: 'savedRowsUnavailable' },
};

/** Loads one source: its query, its stored file, or its saved rows. */
export function loadDataset(
  env: QueryEnvironment & FileEnvironment & SavedRowsEnvironment,
  dataset: Dataset,
  isStale?: () => boolean,
  context?: DatasetLoadContext,
): Promise<LoadResult> {
  const source = dataset.source;
  const loader = dataset.loader as DatasetLoader | undefined;
  if (source.kind === 'query') return executeDatasetQuery(env, source, isStale, loader, context);
  if (source.kind === 'file') return loadDatasetFile(source.url, source.format, loader, env);
  if (source.kind === 'store') return env.savedRows === undefined ? Promise.resolve(NO_SAVED_ROWS) : env.savedRows(source.path);
  return Promise.resolve({ ok: false, kind: 'refused', message: 'Nothing to load.' });
}

function isReusedLoad(result: LoadResult): result is LoadSuccess & { at: number } {
  return result.ok && result.at !== undefined && result.fetched !== true;
}

const isBusyLoad = (result: LoadResult): boolean => !result.ok && result.busy === true;
const isCrowdedLoad = (result: LoadResult): boolean => !result.ok && result.crowded === true;
const isConnectionLoadFailure = (result: LoadResult): boolean => !result.ok && (result.kind === 'reauth' || result.kind === 'absent');
const isConnectionFailureStatus = (status: DatasetRun['status']): boolean => status === 'reauth' || status === 'absent';

function toRunState(result: LoadResult, at: number, kept: OkRun | null, repeat: boolean): OkRun | FailedRun {
  const calls = result.calls === undefined ? {} : { calls: result.calls };
  if (result.ok)
    return {
      status: 'ok',
      table: result.table,
      at,
      ms: result.ms,
      ...(result.value === undefined ? {} : { value: result.value }),
      ...(result.bytes === undefined ? {} : { bytes: result.bytes }),
      ...(result.items === undefined ? {} : { items: result.items }),
      ...(isReusedLoad(result) ? { reused: true as const } : {}),
      ...calls,
    };
  const { message, wording } = repeat && result.again !== undefined ? result.again : result;
  return {
    status: result.kind,
    message,
    ...(wording === undefined ? {} : { wording }),
    at,
    ...(result.off === undefined ? {} : { off: result.off }),
    ...(result.quoted === undefined ? {} : { quoted: result.quoted }),
    ...(result.pageCode === undefined ? {} : { pageCode: result.pageCode }),
    ...(result.timedOut === undefined ? {} : { timedOut: result.timedOut }),
    ...(result.unanswered === undefined ? {} : { unanswered: result.unanswered }),
    ...(kept === null ? {} : { kept }),
    ...calls,
    ...(result.answer === undefined ? {} : { answer: result.answer }),
    ...(result.meta === undefined ? {} : { meta: result.meta }),
  };
}

/**
 * The runs of a dashboard's live sources. Each connector has an adaptive limiter (2 at once, one more per success up
 * to 8, halved on a busy answer); a tool's first call goes in at once. A source runs again only when its load key
 * changes; a connection failure is shared by the connector's other queries while they are in flight.
 */
export function createLiveDatasetStore({
  load,
  concurrency,
  mayBeCached = () => false,
  reuse,
  clock = SYSTEM_CLOCK,
  now = Date.now,
}: LiveStoreOptions): LiveDatasetStore {
  const runs = new Map<string, DatasetRun>();
  const loadKeys = new Map<string, string>();
  const templateKeys = new Map<string, string | undefined>();
  const pendingLoads = new Map<string, Promise<void>>();
  const rerunRequested = new Set<string>();
  const listeners = new Set<() => void>();
  const limiters = new Map<string, AdaptiveLimiter>();
  const calledTools = new Set<string>();
  const connectorFailures = new Map<string, LoadResult>();
  const connectorNudgeTimes = new Map<string, number>();
  const nudgedConnectors = new Set<string>();
  let datasets: Dataset[] = [];
  let version = 0;

  const getLimiter = (connector: string): AdaptiveLimiter => {
    let limiter = limiters.get(connector);
    if (limiter === undefined) {
      limiter = createAdaptiveLimiter(concurrency ?? LIMITER_DEFAULTS.start, concurrency ?? LIMITER_DEFAULTS.ceiling, clock);
      limiters.set(connector, limiter);
    }
    return limiter;
  };
  const notify = (): void => {
    version++;
    for (const listener of listeners) listener();
  };
  const setRun = (id: string, run: DatasetRun): void => {
    runs.set(id, run);
    notify();
  };
  const releaseLimiter = (connector: string, outcome: LimiterOutcome): void => {
    const limiter = getLimiter(connector);
    limiter.release(outcome);
    if (limiter.idle) connectorFailures.delete(connector);
  };
  const liveQueryDatasets = (): Dataset[] => datasets.filter((dataset) => dataset.source.kind === 'query');
  const shouldShareConnectorFailure = (result: LoadResult, dataset: Dataset): boolean =>
    !result.ok && (result.kind === 'reauth' || (dataset.source.kind === 'query' && getSourceConnectorSpec(dataset.source) !== null));

  const loadWithConnectorFailureCache = async (dataset: Dataset, isStale: () => boolean, context: DatasetLoadContext): Promise<LoadResult> => {
    const connector = getLiveDatasetConnector(dataset);
    const shared = connectorFailures.get(connector);
    if (shared !== undefined) return shared;
    const result = await load(dataset, isStale, context, (run) => run()).catch(
      (): LoadResult => ({ ok: false, kind: 'failed', message: 'Couldn’t load this data.', wording: { code: 'loadThrew' } }),
    );
    if (result.ok && !isReusedLoad(result)) {
      connectorNudgeTimes.delete(connector);
      nudgedConnectors.delete(connector);
    }
    if (result.ok || !isConnectionLoadFailure(result)) return result;
    if (shouldShareConnectorFailure(result, dataset))
      connectorFailures.set(connector, {
        ok: false,
        kind: result.kind,
        message: result.message,
        ...(result.wording === undefined ? {} : { wording: result.wording }),
      });
    if (!nudgedConnectors.has(connector)) connectorNudgeTimes.set(connector, now());
    return result;
  };

  const runDataset = (dataset: Dataset): Promise<void> => {
    const key = getDatasetLoadKey(dataset);
    if (key === '') return Promise.resolve();
    const sameKey = loadKeys.get(dataset.id) === key;
    const pending = pendingLoads.get(dataset.id);
    if (pending !== undefined && sameKey) {
      rerunRequested.add(dataset.id);
      return pending;
    }
    rerunRequested.delete(dataset.id);
    const template = dataset.source.kind === 'query' ? dataset.source.template : undefined;
    const keepsPrevious = sameKey || (template !== undefined && templateKeys.get(dataset.id) === template);
    loadKeys.set(dataset.id, key);
    templateKeys.set(dataset.id, template);
    const current = keepsPrevious ? runs.get(dataset.id) : undefined;
    const previous = current === undefined || current.status === 'idle' ? null : current.status === 'running' ? current.prev : current;
    const kept = sameKey && previous !== null ? getLastSuccessfulRun(previous) : null;
    setRun(dataset.id, { status: 'running', startedAt: now(), prev: previous });
    const isStale = (): boolean => loadKeys.get(dataset.id) !== key;
    const onCached = (result: LoadResult, at: number): void => {
      const running = runs.get(dataset.id);
      const cached = toRunState(result, at, null, false);
      if (isStale() || running?.status !== 'running' || running.prev !== null || cached.status !== 'ok') return;
      setRun(dataset.id, { ...running, cached });
    };
    const task = (async (): Promise<void> => {
      const reuseMs = reuse === undefined || dataset.source.kind !== 'query' ? 0 : await reuse().catch(() => 0);
      const connector = getLiveDatasetConnector(dataset);
      const limiter = getLimiter(connector);
      const toolKey = dataset.source.kind === 'query' ? JSON.stringify([dataset.source.connector, dataset.source.tool]) : '';
      if (calledTools.has(toolKey)) await limiter.acquire();
      else {
        calledTools.add(toolKey);
        await limiter.enter();
      }
      let outcome: LimiterOutcome = 'other';
      try {
        if (isStale()) return;
        const cacheable = mayBeCached(dataset, reuseMs);
        const context: DatasetLoadContext = {
          ...(previous === null && cacheable ? { onCached } : {}),
          ...(reuseMs > 0 ? { reuse: { ms: reuseMs, refresh: sameKey || rerunRequested.has(dataset.id) || !cacheable } } : {}),
        };
        const attempt = await retryWhileBusy(
          () => loadWithConnectorFailureCache(dataset, isStale, context),
          isBusyLoad,
          isStale,
          limiter,
          clock,
        );
        outcome = isCrowdedLoad(attempt.result) ? 'busy' : attempt.outcome;
        let result = attempt.result;
        if (result.ok && result.at !== undefined && rerunRequested.has(dataset.id) && !isStale()) {
          result = await loadWithConnectorFailureCache(dataset, isStale, { reuse: { ms: reuseMs, refresh: true } });
          if (isBusyLoad(result) || isCrowdedLoad(result)) outcome = 'busy';
        }
        if (result.ok && !isReusedLoad(result)) outcome = 'ok';
        if (isStale()) return;
        setRun(
          dataset.id,
          toRunState(result, (isReusedLoad(result) ? result.at : undefined) ?? now(), kept, !result.ok && previous?.status === result.kind),
        );
      } finally {
        releaseLimiter(connector, outcome);
      }
    })().finally(() => {
      if (pendingLoads.get(dataset.id) === task) pendingLoads.delete(dataset.id);
    });
    pendingLoads.set(dataset.id, task);
    return task;
  };

  const refreshDataset = (dataset: Dataset): void => {
    connectorFailures.delete(getLiveDatasetConnector(dataset));
    nudgedConnectors.delete(getLiveDatasetConnector(dataset));
    void runDataset(dataset);
  };
  const shouldRetryDataset = (dataset: Dataset, connector?: string): boolean => {
    const run = runs.get(dataset.id) ?? IDLE_DATASET_RUN;
    if (!isFailedDatasetRun(run)) return false;
    return connector === undefined ? isConnectionFailureStatus(run.status) : getLiveDatasetConnector(dataset) === connector;
  };
  const shouldRetrySelectedDataset = (dataset: Dataset, connector?: string): boolean => {
    if (connector === undefined || getLiveDatasetConnector(dataset) !== connector) return false;
    const run = runs.get(dataset.id) ?? IDLE_DATASET_RUN;
    return isFailedDatasetRun(run) || run.status === 'idle';
  };

  return {
    get: (id) => runs.get(id) ?? IDLE_DATASET_RUN,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync(next) {
      datasets = next;
      for (const dataset of next) {
        const key = getDatasetLoadKey(dataset);
        if (key !== '' && loadKeys.get(dataset.id) !== key) void runDataset(dataset);
      }
    },
    run: runDataset,
    refresh: refreshDataset,
    refreshAll: () => liveQueryDatasets().forEach(refreshDataset),
    retryFailed: () =>
      datasets
        .filter((dataset) => {
          const run = runs.get(dataset.id) ?? IDLE_DATASET_RUN;
          if (dataset.source.kind === 'query' || dataset.source.kind === 'store') return isRetryableDatasetFailure(run);
          return dataset.source.kind === 'file' && isPageCodeFailure(run);
        })
        .forEach(refreshDataset),
    retry(connector, selected) {
      const targets = liveQueryDatasets().filter((dataset) => shouldRetryDataset(dataset, connector));
      if (selected !== undefined && shouldRetrySelectedDataset(selected, connector) && !targets.some((dataset) => dataset.id === selected.id))
        targets.push(selected);
      targets.forEach(refreshDataset);
    },
    nudge(at = now()) {
      for (const [connector, time] of connectorNudgeTimes) {
        if (at - time < CONNECTOR_NUDGE_INTERVAL_MS) continue;
        connectorNudgeTimes.delete(connector);
        const targets = liveQueryDatasets().filter(
          (dataset) => getLiveDatasetConnector(dataset) === connector && shouldRetryDataset(dataset),
        );
        targets.forEach(refreshDataset);
        if (targets.length > 0) nudgedConnectors.add(connector);
      }
    },
    put(dataset, result) {
      const key = getDatasetLoadKey(dataset);
      const show = (): void => {
        if (key === '' || loadKeys.get(dataset.id) !== key || pendingLoads.has(dataset.id)) return;
        setRun(dataset.id, toRunState(result, now(), null, false));
      };
      const pending = pendingLoads.get(dataset.id);
      if (pending === undefined) show();
      else void pending.then(show);
    },
    pending: () => pendingLoads.size,
    async settled() {
      while (pendingLoads.size > 0) await Promise.allSettled([...pendingLoads.values()]);
    },
  };
}
