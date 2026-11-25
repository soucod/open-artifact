/**
 * The live-data snapshot of a published dashboard: the answers its live queries gave on the owner's computer, kept as
 * saved rows so a page with no connectors (every page a cloud host serves) can still show real figures.
 *
 * Connectors run only on the owner's computer. While a dashboard is published (and the owner confirmed that its data
 * is published with it), the owner's linked daemon runs each live query there, at the dashboard's stored filters, and
 * writes what the connector answered into the store's `data/` space:
 *
 * - `data/live` ({@link LiveSnapshotStatus}): when the snapshot was taken, on whose computer, and why the last refresh
 *   failed, if it did;
 * - `data/live/answers/<dataset id>` ({@link LiveSnapshotAnswer}): one document per query, holding the calls it made and
 *   their answers as the connector gave them.
 *
 * A page that cannot call a connector replays these answers through the same readers and loaders a live answer goes
 * through ({@link findSnapshotCall}): the figures are the owner's, as of `at`. A call the snapshot does not hold (a
 * viewer's own filter value, a loader's follow-up call the daemon could not make) stays "not available in this view".
 * Each answer is one document, so the store's 256 KB document limit is per query: a query whose answer is larger fails
 * by itself, by name, and is never cut short. A failed refresh keeps the answers it had.
 *
 * A dataset opts out with `"snapshot": false` in its document: its query never leaves the owner's computer.
 */

import { isPlainObject } from './text.ts';
import type { UnknownRecord } from './types.ts';
import type { McpToolResult } from './connector-types.ts';
import { DATASETS_COLLECTION } from './paths.ts';
import { prepareDashboardContent } from './fill.ts';
import { composeDashboardDocuments } from './records.ts';
import { parseStoredQueryArgs } from './connectors.ts';

/** The snapshot's status document. */
export const LIVE_SNAPSHOT_PATH = 'data/live';
/** The collection of the snapshot's answers, one document per dataset id. */
export const LIVE_SNAPSHOT_ANSWERS = 'data/live/answers';
/** The largest snapshot document, bytes of its JSON (the store's document limit). */
export const LIVE_SNAPSHOT_DOC_MAX_BYTES = 256 * 1024;

/** Why a refresh did not bring new answers, and when. */
export interface LiveSnapshotFailure {
  at: string;
  reason: string;
}

/** `data/live`: the snapshot as a whole. */
export interface LiveSnapshotStatus {
  /** When the newest answers were taken (ISO). */
  at: string | null;
  /** Whose computer took them: the owner's name. */
  owner: string;
  /** The queries the last refresh asked for, and the ones of them that failed (the rest of `data/live/answers` stays). */
  queries?: string[];
  /** The last refresh failed (in whole, or these queries): the answers before it are kept. Only the owner is shown it. */
  failed?: LiveSnapshotFailure & { queries?: string[] };
}

/** One call a query made, and its answer as the connector gave it. */
export interface LiveSnapshotCall {
  tool: string;
  args: UnknownRecord;
  result: McpToolResult;
}

/** `data/live/answers/<dataset id>`: one query's answers. */
export interface LiveSnapshotAnswer {
  /** When these answers were taken (ISO); `null` before any refresh succeeded. */
  at: string | null;
  connector: string;
  calls: LiveSnapshotCall[];
  /** This query's last refresh failed: `calls` are the ones before it. */
  failed?: LiveSnapshotFailure;
}

/** A live query of a dashboard, as a refresh runs it: its dataset, connector, tool and filled arguments. */
export interface LiveQueryPlan {
  id: string;
  connector: string;
  tool: string;
  args: UnknownRecord;
  /** Why it can't run at the stored filters (an unfilled filter, a refused rule), else absent. */
  problem?: string;
}

/** The path of a dataset's answers. */
export function liveSnapshotAnswerPath(id: string): string {
  return `${LIVE_SNAPSHOT_ANSWERS}/${id}`;
}

/** Whether a store path is part of the snapshot (only the owner's daemon writes it). */
export function isLiveSnapshotPath(path: string): boolean {
  return path === LIVE_SNAPSHOT_PATH || path.startsWith(`${LIVE_SNAPSHOT_ANSWERS}/`);
}

/** A JSON text whose object keys are sorted: two equal arguments give one text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value) ?? 'null';
  const record = value as Record<string, unknown>;
  const entries: string[] = [];
  for (const key of Object.keys(record).sort()) if (record[key] !== undefined) entries.push(`${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

/** Whether the dataset document keeps its query off the snapshot (`"snapshot": false`). */
export function isSnapshotOptedOut(document: unknown): boolean {
  return isPlainObject(document) && document.snapshot === false;
}

/**
 * The dashboard's live queries as a refresh runs them: every query dataset not opted out, filled with the stored
 * filters (`dash/params`), in dataset id order. `only` keeps the named ones.
 */
export function planLiveQueries(documents: ReadonlyMap<string, UnknownRecord>, only?: readonly string[]): LiveQueryPlan[] {
  const content = prepareDashboardContent(composeDashboardDocuments(documents).content);
  const plans: LiveQueryPlan[] = [];
  for (const dataset of content.datasets) {
    const source = dataset.source;
    if (source.kind !== 'query') continue;
    if (isSnapshotOptedOut(documents.get(`${DATASETS_COLLECTION}/${dataset.id}`))) continue;
    if (only !== undefined && !only.includes(dataset.id)) continue;
    const problem = source.problem ?? source.unfilled ?? (source.connector === '' ? 'it names no connector' : source.tool === '' ? 'it names no tool' : undefined);
    plans.push({ id: dataset.id, connector: source.connector, tool: source.tool, args: parseStoredQueryArgs(source), ...(problem === undefined ? {} : { problem }) });
  }
  return plans.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Whether a dashboard has any live query the snapshot would hold. */
export function hasLiveQueries(documents: ReadonlyMap<string, UnknownRecord>): boolean {
  return planLiveQueries(documents).length > 0;
}

/** Bytes of a document's JSON. */
export function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/** Why a query's answers can't be kept (larger than a document may be), naming it; `null` when they fit. */
export function liveAnswerSizeProblem(id: string, answer: LiveSnapshotAnswer): string | null {
  const bytes = jsonBytes(answer);
  if (bytes <= LIVE_SNAPSHOT_DOC_MAX_BYTES) return null;
  const kb = (n: number): string => `${Math.ceil(n / 1024)} KB`;
  return `The answer of query "${id}" is ${kb(bytes)}, over the ${kb(LIVE_SNAPSHOT_DOC_MAX_BYTES)} a saved document may hold, so it was not published (nothing was cut). Aggregate it in the query, or keep it on this computer with "snapshot": false.`;
}

/** A snapshot status document as read, or `null` when it isn't one. */
export function parseLiveSnapshotStatus(value: unknown): LiveSnapshotStatus | null {
  if (!isPlainObject(value)) return null;
  const at = typeof value.at === 'string' && value.at !== '' ? value.at : null;
  const owner = typeof value.owner === 'string' ? value.owner : '';
  const status: LiveSnapshotStatus = { at, owner };
  if (Array.isArray(value.queries)) status.queries = value.queries.filter((item): item is string => typeof item === 'string');
  const failed = value.failed;
  if (isPlainObject(failed) && typeof failed.reason === 'string') {
    status.failed = { at: typeof failed.at === 'string' ? failed.at : '', reason: failed.reason };
    if (Array.isArray(failed.queries)) status.failed.queries = failed.queries.filter((item): item is string => typeof item === 'string');
  }
  return status;
}

/** A snapshot answer document as read, or `null` when it isn't one. */
export function parseLiveSnapshotAnswer(value: unknown): LiveSnapshotAnswer | null {
  if (!isPlainObject(value) || typeof value.connector !== 'string' || !Array.isArray(value.calls)) return null;
  const calls: LiveSnapshotCall[] = [];
  for (const call of value.calls as unknown[]) {
    if (!isPlainObject(call) || typeof call.tool !== 'string' || !isPlainObject(call.result)) continue;
    calls.push({ tool: call.tool, args: isPlainObject(call.args) ? call.args : {}, result: call.result as McpToolResult });
  }
  const answer: LiveSnapshotAnswer = { at: typeof value.at === 'string' && value.at !== '' ? value.at : null, connector: value.connector, calls };
  if (isPlainObject(value.failed) && typeof value.failed.reason === 'string')
    answer.failed = { at: typeof value.failed.at === 'string' ? value.failed.at : '', reason: value.failed.reason };
  return answer;
}

/** The recorded answer of this exact call (connector, tool and arguments, key order aside), or `null`. */
export function findSnapshotCall(
  answers: Iterable<LiveSnapshotAnswer>,
  connector: string,
  tool: string,
  args: UnknownRecord,
): { result: McpToolResult; at: string | null } | null {
  const wanted = canonicalJson(args);
  for (const answer of answers) {
    if (answer.connector !== connector) continue;
    for (const call of answer.calls) if (call.tool === tool && canonicalJson(call.args) === wanted) return { result: call.result, at: answer.at };
  }
  return null;
}
