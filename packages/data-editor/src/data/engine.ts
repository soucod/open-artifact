import type { AgentCapability, McpCapability } from '@open-artifact/runtime';
import {
  EMPTY_DASHBOARD_CONTENT,
  SYSTEM_CLOCK,
  applyParameterOverrides,
  copyResultMetadata,
  getEffectiveParameters,
  getFilteredDatasets,
  getUpdatesIntervalMs,
  isValidDatasetId,
  parseParameters,
  parseStoredQueryArgs,
  prepareDashboardContent,
  resolveSavedRowsPath,
  sanitizeSingleLine,
  type CalculationEngine,
  type CalculationReport,
  type ConnectionFix,
  type DashboardContent,
  type DashboardNotice,
  type Dataset,
  type DatasetLoader,
  type DatasetNotice,
  type DatasetRun,
  type DatasetStatus,
  type Parameters,
  type PollClock,
  type ResultMetadata,
  type Row,
  type Table,
} from '@open-artifact/data-core';
import { maybeSession } from '../services/session.ts';
import { useShown } from '../state/shown.ts';
import { createDatasetsStore, type DatasetsStore } from '../state/datasets.ts';
import { createCalculationEngine, getFunctionCode } from './calc-engine.ts';
import { appendCalculationDatasets, getCalculationRun } from './calculations.ts';
import { connectorSetupRequest, getConnectionFixAction, type ConnectionFixAction } from './fixes.ts';
import { createLiveSnapshotSource, withLiveSnapshot, type LiveSnapshotSource } from './live-snapshot.ts';
import { createMcpToolClient, type ConnectorTool } from './mcp.ts';
import {
  IDLE_DATASET_RUN,
  applyFetchPriority,
  attachDatasetLoaders,
  createLiveDatasetStore,
  getConnectionFix,
  getDatasetLoadKey,
  getLastSuccessfulRun,
  getRunTable,
  isFailedDatasetRun,
  loadDataset,
  type LiveDatasetStore,
} from './query-store.ts';
import { createSavedRowsReader, type SavedRowsReader } from './saved-rows.ts';
import { getDashboardNotice, getDatasetNotice, getDatasetStatus, getOldestDatasetUpdate, getToolbarText, partitionUsedDatasets } from './status.ts';
import { createToolResultCache, getToolCacheGcTime } from './tool-cache.ts';

export type PageDataStatus = 'ok' | 'missing' | 'loading' | 'error' | 'connect' | 'declined';

/** What `dash.data(id)` gives the page: rows copied for it, or a value; a status and message otherwise. */
export interface PageDataResult {
  status: PageDataStatus;
  /** The rows, or a value (a calculation's result, a loader's plain data). */
  data: unknown;
  columns: string[];
  rows: Row[];
  message: string;
  /** A newer run is loading while these rows show. */
  refreshing: boolean;
  /** The rows are a cut of a larger result. */
  truncated: boolean;
  meta: ResultMetadata[];
  value?: unknown;
}

export interface DataEngineOptions {
  mcp?: () => McpCapability | null;
  agent?: () => AgentCapability | null;
  fetch?: typeof fetch;
  /** The address stored files resolve against. */
  base?: () => string | undefined;
  storage?: () => Storage | undefined;
  /** Separates this dashboard's cached answers from others' (defaults to the page's path). */
  scope?: string;
  /** The clock limiters, polls and loader waits use. */
  clock?: PollClock;
  /** Wall-clock time for run stamps and statuses. */
  now?: () => number;
  /** A fixed per-connector concurrency instead of the adaptive one. */
  concurrency?: number;
  store?: DatasetsStore;
  /** Where saved rows are read (the session's store when left out). */
  savedRows?: SavedRowsReader;
  /** Who `data/users/me` stands for (the session's viewer when left out). */
  viewerId?: () => string | null;
  /** The live-data snapshot answers fall back to without connectors (the session's store when left out). */
  snapshot?: LiveSnapshotSource;
}

/** The engine that turns the dashboard's datasets into runs and tables for the page and the panels. */
export interface DataEngine {
  readonly store: DatasetsStore;
  /** A source or calculation for the page; reading marks it (and a calculation's sources) as used, so it loads. */
  read(id: string): PageDataResult;
  /** Hears every change of the data the page reads (runs, filters, calculations). */
  subscribe(listener: () => void): () => void;
  version(): number;
  /** The filters in effect: the stored ones with this viewer's choices laid over them. */
  params(): Parameters;
  /** Lays the viewer's choices over the filters (scalars or lists of scalars, no control characters); only the queries that use a changed filter run again. */
  setParams(values: unknown): boolean;
  /** Drops the viewer's choices. */
  resetParams(): boolean;
  /** Runs sources again: these ids (a calculation's sources for a calculation), or every live query. */
  refresh(ids?: string | readonly string[]): void;
  /** `dash.calc(id, {inputs, fn, title?, description?})`. */
  registerCalculation(id: unknown, spec: unknown): void;
  /** `dash.loader(id, {fn, description?})`; throws a TypeError when it isn't one. */
  registerLoader(id: unknown, spec: unknown): void;
  getRun(id: string): DatasetRun;
  getTable(id: string): Table | null;
  getDataset(id: string): Dataset | undefined;
  /** The dashboard's sources with the page's calculations after them. */
  datasets(): readonly Dataset[];
  status(id: string, now?: number): DatasetStatus | null;
  notice(id: string): DatasetNotice | null;
  dashboardNotice(): DashboardNotice | null;
  toolbarText(now?: number): string | null;
  /** Marks sources as used by the page (its `data-source` marks), so they load. */
  use(ids: Iterable<string>): void;
  /** The source the viewer opened in the Sources panel: it loads too. */
  select(id: string | null): void;
  /** The page's `data-fetchpriority` lists, and the sources it marks only under `[hidden]` (loaded last). */
  setFetchPriority(high: readonly string[], low: readonly string[], hidden?: readonly string[]): void;
  retryFailed(): void;
  /** Tries again the queries of a connector (or those that failed to connect). */
  retry(connector?: string): void;
  /** The viewer moved: queries whose connector failed to connect a while ago try again. */
  nudge(): void;
  canAskAgent(): boolean;
  /** Fixes a connection: asks the agent to set the connector up, or tries again. */
  fixConnection(connector: string, fix: ConnectionFix): Promise<ConnectionFixAction>;
  listTools(server?: string): Promise<ConnectorTool[]>;
  /** The dashboard's content (its stored filters are filled into the queries here). */
  setContent(content: DashboardContent): void;
  /** A page (re)mounts: its calculations, loaders and reads start over. */
  beginPage(): void;
  /** Recomputes the time-dependent statuses. */
  tick(now?: number): void;
  /** Resolves once nothing is scheduled or loading. */
  settled(): Promise<void>;
  /** The page wrote these saved-row documents: the sources that show them catch up. */
  rereadSaved(documents: readonly string[]): Promise<void>;
  dispose(): void;
}

const DATASET_LOADER_MESSAGE = 'dash.loader takes a dataset id and {description, fn}.';

function emptyPageDataResult(status: Exclude<PageDataStatus, 'ok'>, message: string): PageDataResult {
  return { status, data: [], columns: [], rows: [], message, refreshing: false, truncated: false, meta: [] };
}

const tableRowCopies = new WeakMap<Table, Row[]>();

function copyCachedRows(table: Table): Row[] {
  let rows = tableRowCopies.get(table);
  if (rows === undefined) {
    rows = table.rows.map((row) => ({ ...row }));
    tableRowCopies.set(table, rows);
  }
  return rows.map((row) => ({ ...row }));
}

function successfulPageDataResult(table: Table, value: unknown, refreshing: boolean): PageDataResult {
  const rows = copyCachedRows(table);
  const meta = copyResultMetadata(table);
  const truncated = table.cut !== undefined;
  if (value === undefined) return { status: 'ok', data: rows, columns: [...table.columns], rows, message: '', refreshing, truncated, meta };
  const copy = structuredClone(value);
  return { status: 'ok', data: copy, columns: [], rows, message: '', refreshing, truncated, meta, value: copy };
}

function parseDatasetLoader(id: unknown, spec: unknown): DatasetLoader | null {
  const record = typeof spec === 'object' && spec !== null ? (spec as Record<string, unknown>) : {};
  const fn = record.fn;
  if (!isValidDatasetId(id) || typeof fn !== 'function') return null;
  return {
    fn: fn as DatasetLoader['fn'],
    code: getFunctionCode(fn),
    description: typeof record.description === 'string' ? sanitizeSingleLine(record.description) : '',
  };
}

function defaultScope(): string {
  const path = globalThis.location?.pathname;
  return typeof path === 'string' ? path : '';
}

export function createDataEngine(options: DataEngineOptions = {}): DataEngine {
  const mcp = options.mcp ?? (() => maybeSession()?.mcp ?? null);
  const agent = options.agent ?? (() => maybeSession()?.agent ?? null);
  const clock = options.clock ?? SYSTEM_CLOCK;
  const now = options.now ?? Date.now;
  const store = options.store ?? createDatasetsStore();
  const cache = createToolResultCache({
    ...(options.storage === undefined ? {} : { storage: options.storage }),
    scope: options.scope ?? defaultScope(),
    now,
  });
  const ownsSnapshot = options.snapshot === undefined;
  const snapshot = options.snapshot ?? createLiveSnapshotSource(() => maybeSession()?.db ?? null);
  // Without connectors (a hosted page), the answers the owner's computer took stand in for live calls.
  const client = withLiveSnapshot(createMcpToolClient({ mcp, cache }), () => mcp() !== null, snapshot);
  const ownsSavedRows = options.savedRows === undefined;
  const savedRows = options.savedRows ?? createSavedRowsReader({ db: () => maybeSession()?.db ?? null, clock });
  const viewerId = options.viewerId ?? (() => maybeSession()?.viewer.id ?? null);
  const savedRowsPath = (path: string): string => {
    const id = viewerId();
    return id === null || id === '' ? path : resolveSavedRowsPath(path, id);
  };
  const env = {
    client,
    clock,
    savedRows: (path: string) => savedRows.load(savedRowsPath(path)),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.base === undefined ? {} : { base: options.base }),
  };

  let content: DashboardContent = EMPTY_DASHBOARD_CONTENT;
  let overrides: Parameters = store.getState().overrides;
  let effective: Parameters = getEffectiveParameters(content, overrides);
  let base: Dataset[] = [];
  let baseById = new Map<string, Dataset>();
  let listed: Dataset[] = [];
  let listedById = new Map<string, Dataset>();
  const loaders = new Map<string, DatasetLoader>();
  const reports = new Map<string, CalculationReport>();
  let requested: string[] = [];
  let selected: string | null = null;
  let priority: { high: readonly string[]; low: readonly string[]; hidden: readonly string[] } = { high: [], low: [], hidden: [] };
  let dataVersion = 0;
  let syncScheduled = false;
  let publishScheduled = false;
  let disposed = false;
  const listeners = new Set<() => void>();

  const live: LiveDatasetStore = createLiveDatasetStore({
    load: (dataset, isStale, context) => loadDataset(env, dataset, isStale, context),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
    mayBeCached: (dataset, reuseMs) => {
      const source = dataset.source;
      return source.kind === 'query' && cache.read(source.connector, source.tool, parseStoredQueryArgs(source), getToolCacheGcTime(reuseMs)) !== null;
    },
    reuse: async () => getUpdatesIntervalMs(content.updates),
    clock,
    now,
  });

  const getRun = (id: string): DatasetRun => {
    const dataset = listedById.get(id);
    if (dataset === undefined) return IDLE_DATASET_RUN;
    if (dataset.source.kind === 'calc') return getCalculationRun(dataset.source, (other) => listedById.get(other), getRun);
    return live.get(id);
  };

  const relist = (): void => {
    listed = appendCalculationDatasets(base, reports);
    listedById = new Map(listed.map((dataset) => [dataset.id, dataset]));
  };

  const rebuild = (): void => {
    effective = getEffectiveParameters(content, overrides);
    base = attachDatasetLoaders(getFilteredDatasets(content, overrides), loaders);
    baseById = new Map(base.map((dataset) => [dataset.id, dataset]));
    relist();
  };

  const usedIds = (): string[] => (selected === null || requested.includes(selected) ? requested : [...requested, selected]);

  const loadingIds = (): string[] =>
    partitionUsedDatasets(base, usedIds())
      .used.filter((dataset) => {
        const status = live.get(dataset.id).status;
        return (status === 'running' || status === 'idle') && getDatasetLoadKey(dataset) !== '';
      })
      .map((dataset) => dataset.id);

  const toolbarText = (time: number): string | null => {
    const used = partitionUsedDatasets(listed, usedIds()).used;
    const loading = loadingIds();
    const usedQueries = used.filter((dataset) => dataset.source.kind === 'query');
    const firstLoad = loading.some((id) => getLastSuccessfulRun(live.get(id)) === null);
    return getToolbarText({
      loading: loading.length === 0 ? null : firstLoad ? 'first' : 'again',
      loadingNow: loading.length,
      updatedAt: getOldestDatasetUpdate(usedQueries.length > 0 ? usedQueries : used, getRun, time).at,
      now: time,
    });
  };

  const publish = (): void => {
    publishScheduled = false;
    if (disposed) return;
    const time = now();
    const runs = new Map<string, DatasetRun>();
    const statuses = new Map<string, DatasetStatus>();
    for (const dataset of listed) {
      const run = getRun(dataset.id);
      runs.set(dataset.id, run);
      statuses.set(dataset.id, getDatasetStatus(dataset, run, time));
    }
    store.setState((state) => ({
      runs,
      statuses,
      requested: [...requested],
      params: effective,
      overrides,
      datasets: listed,
      reports: new Map(reports),
      notice: getDashboardNotice(partitionUsedDatasets(listed, usedIds()).used, getRun),
      toolbar: toolbarText(time),
      loading: loadingIds(),
      now: time,
      version: state.version + 1,
    }));
  };

  const schedulePublish = (dataChanged: boolean): void => {
    if (dataChanged) {
      dataVersion++;
      for (const listener of [...listeners]) listener();
    }
    if (publishScheduled || disposed) return;
    publishScheduled = true;
    queueMicrotask(publish);
  };

  const sync = (): void => {
    syncScheduled = false;
    if (disposed) return;
    live.sync(applyFetchPriority(partitionUsedDatasets(base, usedIds()).used, priority.high, priority.low, priority.hidden));
    schedulePublish(false);
  };

  const scheduleSync = (): void => {
    if (syncScheduled || disposed) return;
    syncScheduled = true;
    queueMicrotask(sync);
  };

  const newCalculationEngine = (): CalculationEngine =>
    createCalculationEngine({
      now,
      has: (id) => baseById.has(id),
      input: (id) => {
        const result = readSource(id);
        return { status: result.status, rows: result.rows, ...(result.value === undefined ? {} : { value: result.value }) };
      },
      stateOf: (id) => [baseById.get(id), live.get(id)],
      params: () => effective,
      post: (report) => {
        if (disposed) return;
        reports.set(report.id, report);
        relist();
        schedulePublish(true);
      },
    });

  let calculations = newCalculationEngine();

  const markRequested = (ids: Iterable<string>): void => {
    let added = false;
    for (const id of ids)
      if (!requested.includes(id)) {
        requested.push(id);
        added = true;
      }
    if (added) scheduleSync();
  };

  const readSource = (id: string): PageDataResult => {
    const dataset = baseById.get(id);
    if (dataset === undefined) return emptyPageDataResult('missing', `No dataset “${id}” in this dashboard.`);
    if (dataset.source.kind === 'unsupported')
      return emptyPageDataResult('error', `This dashboard can’t read “${dataset.source.rawKind}” sources.`);
    const run = live.get(id);
    const table = getRunTable(run);
    if (table !== null) return successfulPageDataResult(table, getLastSuccessfulRun(run)?.value, run.status === 'running');
    if (run.status === 'idle' || run.status === 'running') return emptyPageDataResult('loading', '');
    if (isFailedDatasetRun(run) && getConnectionFix(run) !== null) return emptyPageDataResult('connect', run.message);
    if (run.status === 'declined') return emptyPageDataResult('declined', run.message);
    return emptyPageDataResult('error', 'message' in run ? run.message : '');
  };

  const datasetsFor = (ids: readonly string[]): Dataset[] => {
    const found: Dataset[] = [];
    for (const id of ids) {
      const under = calculations.under(id);
      for (const source of under ?? [id]) {
        const dataset = baseById.get(source);
        if (dataset !== undefined && !found.includes(dataset)) found.push(dataset);
      }
    }
    return found;
  };

  live.subscribe(() => schedulePublish(true));
  // New answers pushed from the owner's computer: the live queries run again on them.
  const stopSnapshot = snapshot.subscribe(() => {
    if (!disposed && mcp() === null) live.refreshAll();
  });
  const stopSavedRows = savedRows.subscribe((path) => {
    const table = savedRows.current(path);
    if (table === null) return;
    for (const dataset of base)
      if (dataset.source.kind === 'store' && savedRowsPath(dataset.source.path) === path) live.put(dataset, { ok: true, table, ms: 0 });
  });

  /** A calculation is refreshing while one of its sources is, and cut when one of their tables is. */
  const calculationState = (sources: readonly string[]): { refreshing: boolean; truncated: boolean } => {
    let refreshing = false;
    let truncated = false;
    for (const id of sources) {
      if (!baseById.has(id)) continue;
      const run = live.get(id);
      const table = getRunTable(run);
      if (table === null) continue;
      if (run.status === 'running') refreshing = true;
      if (table.cut !== undefined) truncated = true;
    }
    return { refreshing, truncated };
  };

  const engine: DataEngine = {
    store,
    read(id) {
      if (!isValidDatasetId(id)) return readSource(id);
      const under = calculations.under(id);
      if (under === undefined) {
        markRequested([id]);
        return readSource(id);
      }
      markRequested([id, ...under]);
      const data = calculations.data(id);
      const state = data.status === 'ok' ? calculationState(under) : { refreshing: false, truncated: false };
      return {
        status: data.status,
        data: data.value,
        columns: [],
        rows: [],
        message: data.message,
        ...state,
        meta: [],
        value: data.value,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version: () => dataVersion,
    params: () => effective,
    setParams(values) {
      const parsed = parseParameters(values);
      if (Object.keys(parsed).length === 0) return false;
      const next = applyParameterOverrides(overrides, parsed);
      if (next === overrides) return false;
      overrides = next;
      rebuild();
      scheduleSync();
      schedulePublish(true);
      return true;
    },
    resetParams() {
      const next = applyParameterOverrides(overrides, null);
      if (next === overrides) return false;
      overrides = next;
      rebuild();
      scheduleSync();
      schedulePublish(true);
      return true;
    },
    refresh(ids) {
      if (ids === undefined) {
        live.refreshAll();
        return;
      }
      const targets = datasetsFor(typeof ids === 'string' ? [ids] : ids);
      markRequested(targets.map((dataset) => dataset.id));
      for (const dataset of targets) live.refresh(dataset);
    },
    registerCalculation(id, spec) {
      if (disposed) return;
      const wasSource = typeof id === 'string' && requested.includes(id) && calculations.under(id) === undefined;
      calculations.define(id, spec);
      if (wasSource) schedulePublish(true);
    },
    registerLoader(id, spec) {
      const loader = parseDatasetLoader(id, spec);
      if (loader === null) throw new TypeError(DATASET_LOADER_MESSAGE);
      const known = loaders.get(id as string);
      if (known !== undefined && known.code === loader.code && known.fn === loader.fn) return;
      loaders.set(id as string, known !== undefined && known.code === loader.code ? { ...loader } : loader);
      rebuild();
      scheduleSync();
    },
    getRun,
    getTable: (id) => getRunTable(getRun(id)),
    getDataset: (id) => listedById.get(id),
    datasets: () => listed,
    status(id, time = now()) {
      const dataset = listedById.get(id);
      return dataset === undefined ? null : getDatasetStatus(dataset, getRun(id), time);
    },
    notice(id) {
      const dataset = listedById.get(id);
      return dataset === undefined ? null : getDatasetNotice(dataset, getRun(id));
    },
    dashboardNotice: () => getDashboardNotice(partitionUsedDatasets(listed, usedIds()).used, getRun),
    toolbarText: (time = now()) => toolbarText(time),
    use(ids) {
      markRequested(ids);
    },
    select(id) {
      if (selected === id) return;
      selected = id;
      scheduleSync();
    },
    setFetchPriority(high, low, hidden = []) {
      priority = { high: [...high], low: [...low], hidden: [...hidden] };
      scheduleSync();
    },
    retryFailed: () => live.retryFailed(),
    retry(connector) {
      const chosen = selected === null ? undefined : baseById.get(selected);
      live.retry(connector, chosen);
    },
    nudge: () => live.nudge(now()),
    canAskAgent: () => agent() !== null,
    async fixConnection(connector, fix) {
      const helper = agent();
      if (helper !== null && getConnectionFixAction(fix, true) === 'agent') {
        const sent = await helper.send(connectorSetupRequest(connector, fix)).catch(() => null);
        if (sent !== null && sent.status !== 'failed') return 'agent';
      }
      engine.retry(connector);
      return 'retry';
    },
    listTools: (server) => client.listTools(server),
    setContent(next) {
      const prepared = prepareDashboardContent(next);
      if (prepared === content) return;
      content = prepared;
      rebuild();
      scheduleSync();
      schedulePublish(true);
    },
    beginPage() {
      calculations = newCalculationEngine();
      reports.clear();
      loaders.clear();
      requested = [];
      rebuild();
      scheduleSync();
      schedulePublish(true);
    },
    tick(time) {
      if (time !== undefined) store.setState({ now: time });
      schedulePublish(false);
    },
    async settled() {
      do {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        await live.settled();
      } while (syncScheduled || publishScheduled || live.pending() > 0);
    },
    rereadSaved: (documents) => savedRows.reread(documents.map(savedRowsPath)),
    dispose() {
      disposed = true;
      listeners.clear();
      stopSavedRows();
      stopSnapshot();
      if (ownsSavedRows) savedRows.dispose();
      if (ownsSnapshot) snapshot.dispose();
    },
  };
  rebuild();
  return engine;
}

/** How often time-dependent statuses ("Updated 5 mins ago", stale files) are recomputed. */
export const STATUS_TICK_MS = 30_000;
/** Coming back to the page retries failed connections at most this often. */
export const RECONNECT_RETRY_INTERVAL_MS = 5000;

let current: DataEngine | null = null;

/** The running engine; throws before {@link startDataEngine}. */
export function dataEngine(): DataEngine {
  if (current === null) throw new Error('The data engine has not started.');
  return current;
}

export function maybeDataEngine(): DataEngine | null {
  return current;
}

/**
 * Starts the engine on the content the page shows (the stored dashboard, a draft or a history version): every change re-syncs it. In a browser, coming back to the
 * page retries failed connections and the viewer's moves nudge them; statuses tick every 30 s.
 */
export function startDataEngine(options: DataEngineOptions = {}): DataEngine {
  current?.dispose();
  const engine = createDataEngine(options);
  current = engine;
  engine.setContent(useShown.getState().shown.content);
  const stops: (() => void)[] = [
    useShown.subscribe((state, previous) => {
      if (state.shown.content !== previous.shown.content) engine.setContent(state.shown.content);
    }),
  ];
  const target = globalThis.window;
  if (target !== undefined && typeof target.addEventListener === 'function') {
    let lastRetry = 0;
    const retry = (): void => {
      if (globalThis.document?.visibilityState === 'hidden') return;
      const time = Date.now();
      if (time - lastRetry < RECONNECT_RETRY_INTERVAL_MS) return;
      lastRetry = time;
      engine.retry();
    };
    const nudge = (): void => engine.nudge();
    const listen = (on: EventTarget, type: string, handler: () => void): void => {
      on.addEventListener(type, handler, { passive: true });
      stops.push(() => on.removeEventListener(type, handler));
    };
    listen(target, 'focus', retry);
    listen(target, 'pageshow', retry);
    if (globalThis.document !== undefined) listen(globalThis.document, 'visibilitychange', retry);
    for (const type of ['pointermove', 'pointerdown', 'keydown']) listen(target, type, nudge);
    const timer = setInterval(() => engine.tick(), STATUS_TICK_MS);
    stops.push(() => clearInterval(timer));
  }
  const dispose = engine.dispose;
  engine.dispose = () => {
    for (const stop of stops) stop();
    dispose();
    if (current === engine) current = null;
  };
  return engine;
}
