/** The Sources list: its groups, its rows' statuses and captions, and the trail of sources opened from one another. */

import type { ConnectionFix, Dataset, DatasetRun, GetRun } from '@open-artifact/data-core';
import { getDatasetQuery } from '@open-artifact/data-core';
import { getConnectionFix, getLastSuccessfulRun, isFailedDatasetRun, isPageCodeFailure } from '../data/query-store.ts';
import { describeLoadFailure, formatTimeAgo, getDatasetStatus, getDatasetUpdatedAt, isJustNow } from '../data/status.ts';
import { BACK_TO_SOURCES_LABEL, DIDNT_LOAD_LABEL, DIDNT_RUN_LABEL, backToSourceLabel } from './words.ts';

export interface ConnectorSourceGroup {
  connector: string;
  rows: Dataset[];
}

export interface SourceGroups {
  connectors: ConnectorSourceGroup[];
  files: Dataset[];
  /** Saved rows, kept in the artifact's own store. */
  stores: Dataset[];
  rest: Dataset[];
  calcs: Dataset[];
}

/** A row's mark: a spinner while loading, a dot for a problem or a warning. */
export type SourceRowStatus = { kind: 'loading' } | { kind: 'problem' | 'warn'; reason: string; heard: string };

/** The connection a row can fix: its connector and how. */
export interface SourceConnectionAction {
  connector: string;
  fix: ConnectionFix;
}

/** Connectors some query couldn't reach, with the first fix one of them needs (`null` when none fits). */
export type ConnectionStates = ReadonlyMap<string, ConnectionFix | null>;

export interface LocalRunEntry {
  at: number;
  ok: boolean;
}

export const LOCAL_RUN_STORAGE_PREFIX = 'dash-runs:';
export const MAX_LOCAL_RUN_HISTORY = 20;

/** Query sources by connector (in order of first use), then files, saved rows, the rest, and calculations ("Transforms"). */
export function groupSourcesByConnector(datasets: readonly Dataset[]): SourceGroups {
  const connectors: ConnectorSourceGroup[] = [];
  const files: Dataset[] = [];
  const stores: Dataset[] = [];
  const rest: Dataset[] = [];
  const calcs: Dataset[] = [];
  for (const dataset of datasets) {
    const { source } = dataset;
    if (source.kind === 'query' && source.connector !== '') {
      let group = connectors.find((candidate) => candidate.connector === source.connector);
      if (group === undefined) connectors.push((group = { connector: source.connector, rows: [] }));
      group.rows.push(dataset);
    } else if (source.kind === 'file') files.push(dataset);
    else if (source.kind === 'store') stores.push(dataset);
    else if (source.kind === 'calc') calcs.push(dataset);
    else rest.push(dataset);
  }
  return { connectors, files, stores, rest, calcs };
}

/** The trail after opening a source: back to it when it is on the trail, else one more step. */
export function pushSourceTrail(trail: readonly string[], id: string): string[] {
  const at = trail.indexOf(id);
  return at === -1 ? [...trail, id] : trail.slice(0, at + 1);
}

export function popSourceTrail(trail: readonly string[]): string[] {
  return trail.slice(0, -1);
}

export function getTrailSource(trail: readonly string[]): string | null {
  return trail[trail.length - 1] ?? null;
}

/** "Back to Sources", or back to the source this one was opened from. */
export function getSourceBackLabel(trail: readonly string[], nameOf: (id: string) => string): string {
  const previous = trail[trail.length - 2];
  return previous === undefined ? BACK_TO_SOURCES_LABEL : backToSourceLabel(nameOf(previous));
}

/** The datasets with the selected one added when it isn't listed (a source opened from elsewhere). */
export function includeSelectedDataset(listed: readonly Dataset[], all: readonly Dataset[], selected: string | null): readonly Dataset[] {
  const found = all.find((dataset) => dataset.id === selected);
  return found === undefined || listed.some((dataset) => dataset.id === found.id) ? listed : [...listed, found];
}

const LOADED_KINDS: ReadonlySet<Dataset['source']['kind']> = new Set(['query', 'file', 'store']);

/** A query, file or saved rows that haven't loaded yet count as loading, unless nothing asked for them. */
export function isDatasetLoading(dataset: Dataset, run: DatasetRun, unasked = false): boolean {
  return run.status === 'running' || (!unasked && run.status === 'idle' && LOADED_KINDS.has(dataset.source.kind));
}

/** A live query or saved rows that failed (or a file whose loader's code failed): Retry may help. */
export function isLiveQueryFailure(dataset: Dataset, run: DatasetRun): boolean {
  if (!isFailedDatasetRun(run) || run.status !== 'failed') return false;
  return dataset.source.kind === 'query' || dataset.source.kind === 'store' || (dataset.source.kind === 'file' && isPageCodeFailure(run));
}

function isLocalRunEntry(value: unknown): value is LocalRunEntry {
  if (typeof value !== 'object' || value === null) return false;
  const { at, ok } = value as { at?: unknown; ok?: unknown };
  return typeof at === 'number' && typeof ok === 'boolean';
}

function localStorageOrNull(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** This browser's last runs of a query (kept to say when it last loaded once it fails). */
export function readLocalRunHistory(id: string, storage: Storage | null = localStorageOrNull()): LocalRunEntry[] {
  try {
    const value: unknown = JSON.parse(storage?.getItem(LOCAL_RUN_STORAGE_PREFIX + id) ?? 'null');
    return Array.isArray(value)
      ? value
          .filter(isLocalRunEntry)
          .slice(-MAX_LOCAL_RUN_HISTORY)
          .map(({ at, ok }) => ({ at, ok }))
      : [];
  } catch {
    return [];
  }
}

export function appendLocalRunHistory(id: string, entry: LocalRunEntry, storage: Storage | null = localStorageOrNull()): void {
  try {
    const entries = readLocalRunHistory(id, storage);
    if (!entries.some((existing) => existing.at === entry.at))
      storage?.setItem(LOCAL_RUN_STORAGE_PREFIX + id, JSON.stringify([...entries, entry].slice(-MAX_LOCAL_RUN_HISTORY)));
  } catch {
    // Storage may be full or blocked; the log is only a convenience.
  }
}

/** A finished run as a log entry. */
export function createLocalRunEntry(run: DatasetRun): LocalRunEntry | null {
  if (run.status === 'idle' || run.status === 'running') return null;
  return { at: run.at, ok: run.status === 'ok' };
}

/** When the source's data last loaded: its last good run, or for a failed query this browser's last good run. */
export function getLastLoadedAt(dataset: Dataset, run: DatasetRun, storage?: Storage | null): number | null {
  const at = getDatasetUpdatedAt(dataset, run);
  if (at !== null || dataset.source.kind !== 'query' || !isFailedDatasetRun(run)) return at;
  return readLocalRunHistory(dataset.id, storage).findLast((entry) => entry.ok)?.at ?? null;
}

function joinConnectorAge(connector: string, age: string): string {
  return connector === '' || age === '' ? connector || age : `${connector} · ${age}`;
}

function lastLoadedLabel(at: number, now: number): string {
  return isJustNow(at, now) ? 'last loaded just now' : `last loaded ${formatTimeAgo(at, now, true)}`;
}

/** A row's caption: its connector and how long ago it loaded ("Postgres · 5m ago"). */
export function getSourceRowCaption(dataset: Dataset, run: DatasetRun, now: number, storage?: Storage | null): string {
  const at = getLastLoadedAt(dataset, run, storage);
  return joinConnectorAge(getDatasetQuery(dataset)?.connector ?? '', at === null ? '' : formatTimeAgo(at, now));
}

/** A row's accessible name: its title, connector and age spelled out. */
export function getSourceRowAccessibleLabel(title: string, dataset: Dataset, run: DatasetRun, now: number, storage?: Storage | null): string {
  const at = getLastLoadedAt(dataset, run, storage);
  const failedQuery = dataset.source.kind === 'query' && isFailedDatasetRun(run);
  const meta = joinConnectorAge(
    getDatasetQuery(dataset)?.connector ?? '',
    at === null ? '' : failedQuery ? lastLoadedLabel(at, now) : formatTimeAgo(at, now, true),
  );
  return meta === '' ? title : `${title}, ${meta}`;
}

/** A row's mark: loading, a connection to fix (warn), a failure (problem), or the status's own tone. */
export function getSourceRowStatus(dataset: Dataset, run: DatasetRun, now: number, loading: boolean): SourceRowStatus | null {
  if (loading) return { kind: 'loading' };
  if (isFailedDatasetRun(run) && getConnectionFix(run) !== null) {
    const reason = describeLoadFailure(run);
    return { kind: 'warn', reason, heard: reason };
  }
  if (isFailedDatasetRun(run) && run.status !== 'declined') {
    const reason = describeLoadFailure(run);
    return { kind: 'problem', reason, heard: reason };
  }
  const status = getDatasetStatus(dataset, run, now);
  if (status.tone === 'bad') return { kind: 'problem', reason: status.status, heard: status.heard };
  return status.tone === 'warn' ? { kind: 'warn', reason: status.status, heard: status.heard } : null;
}

export function getRowStatusReason(status: SourceRowStatus | null): string | undefined {
  return status === null || status.kind === 'loading' ? undefined : status.reason;
}

export function getRowStatusHeard(status: SourceRowStatus | null): string | undefined {
  return status === null || status.kind === 'loading' ? undefined : status.heard;
}

/** "Didn’t run" for a calculation, "Didn’t load" for anything else. */
export function getSourceFailureLabel(dataset: Dataset): string {
  return dataset.source.kind === 'calc' ? DIDNT_RUN_LABEL : DIDNT_LOAD_LABEL;
}

function needsConnectionFix(run: DatasetRun): boolean {
  return getConnectionFix(run) !== null || run.status === 'declined';
}

/** The connectors some query couldn't reach, each with the fix its first such query needs. */
export function getUnavailableConnectors(datasets: readonly Dataset[], runOf: GetRun): Map<string, ConnectionFix | null> {
  const connectors = new Map<string, ConnectionFix | null>();
  for (const dataset of datasets) {
    if (dataset.source.kind !== 'query') continue;
    const run = runOf(dataset.id);
    if (!needsConnectionFix(run)) continue;
    connectors.set(dataset.source.connector, connectors.get(dataset.source.connector) ?? getConnectionFix(run));
  }
  return connectors;
}

function getSourceConnectionState(dataset: Dataset, run: DatasetRun, down: ConnectionStates): { connector: string; fix: ConnectionFix | null } | null {
  if (dataset.source.kind !== 'query') return null;
  const connector = dataset.source.connector;
  if (needsConnectionFix(run)) return { connector, fix: getConnectionFix(run) };
  if (run.status !== 'idle' || !down.has(connector)) return null;
  return { connector, fix: down.get(connector) ?? null };
}

/** The connection fix a row offers: its own failure's, or (while it waits) its connector's. */
export function getSourceConnectionAction(dataset: Dataset, run: DatasetRun, down: ConnectionStates): SourceConnectionAction | null {
  const state = getSourceConnectionState(dataset, run, down);
  return state === null || state.fix === null ? null : { connector: state.connector, fix: state.fix };
}

/** The row waits on its connector (or a calculation on its inputs). */
export function isSourceWaitingForConnection(dataset: Dataset, run: DatasetRun, down: ConnectionStates): boolean {
  return dataset.source.kind === 'calc' ? run.status === 'idle' : getSourceConnectionState(dataset, run, down) !== null;
}

/**
 * Whether a source's header offers Refresh: a query or file that failed (but not one refused outright), or a query when
 * nothing else on the page refreshes it (`alone`).
 */
export function hasRefreshAction(dataset: Dataset, run: DatasetRun, alone = false): boolean {
  const kind = dataset.source.kind;
  if (!LOADED_KINDS.has(kind)) return false;
  const shown = run.status === 'running' ? run.prev : run;
  if (shown !== null && isFailedDatasetRun(shown)) return shown.status !== 'refused';
  return kind === 'query' && alone;
}

/** The last good run's tool calls (a running or idle source's are its last good run's). */
export function getShownCalls(run: DatasetRun): unknown[] | undefined {
  return run.status === 'running' || run.status === 'idle' ? getLastSuccessfulRun(run)?.calls : run.calls;
}
