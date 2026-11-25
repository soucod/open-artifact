/**
 * The Data type as the server sees it: a db-backed type whose content is the
 * documents under `db/` (see `@open-artifact/data-core`).
 *
 * ```
 * db/dash/meta.json          {title, lang}                 the marker
 * db/dash/{params,look,settings}.json
 * db/datasets/<id>.json      one dataset each
 * db/files/<name>.json       {text}: index.html and the page's other files
 * db/drafts/<id>/…           drafts and remixes
 * db/data/users/<uid>/…      each person's own documents (check, runs, page…)
 * comments.json              review threads
 * ```
 */

import {
  DATASETS_COLLECTION,
  DASH_META_PATH,
  FILES_COLLECTION,
  USER_DATA_COLLECTION,
  checkDataProject,
  dataHistoryIgnores,
  isInViewerFolder,
  isValidDashboardFilename,
  isValidDatasetId,
  LIVE_SNAPSHOT_ANSWERS,
  LIVE_SNAPSHOT_PATH,
  liveAnswerSizeProblem,
  liveSnapshotAnswerPath,
  parseLiveSnapshotAnswer,
  parseLiveSnapshotStatus,
  planLiveQueries,
  scaffoldDataProject,
  validateDataViewContext,
  type DataCheckContext,
  type LiveSnapshotAnswer,
  type LiveSnapshotStatus,
  type McpToolResult,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type { DataRefreshResult } from '@open-artifact/protocol';
import { DOC_MAX_BYTES, mergePatch, splitPath } from '@open-artifact/server-sdk/db';
import type { CheckFinding, WriteRefusal } from './types.ts';

/** The marker file, relative to the content folder (`db/`). */
export const DATA_MARKER = `${DASH_META_PATH}.json`;

/** Files of a new data artifact, relative to `db/`. */
export function scaffoldData(title: string): Record<string, string> {
  return Object.fromEntries(Object.entries(scaffoldDataProject(title)).map(([path, text]) => [`${path}.json`, text]));
}

export const validateDataContext = (value: unknown): unknown => validateDataViewContext(value);

export const dataHistoryIgnoresPath = (path: string): boolean => dataHistoryIgnores(path);

/** A commenter of a share link writes only their own folder, `data/users/<their id>/…` (their saved rows and reports). */
export const dataCommenterWrites = (path: string, guestId: string): boolean => isInViewerFolder(path, guestId);

/** Checks a data artifact. `files` maps document paths (`datasets/sales`) to the raw JSON text on disk. */
export function checkData(files: ReadonlyMap<string, string>, context: DataCheckContext = {}): CheckFinding[] {
  return checkDataProject(files, context);
}

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** What a document would hold after one write, or `undefined` for a delete or a write the store reports itself. */
function writtenData(write: Record<string, unknown>, current: unknown): unknown {
  if (write.op === 'set') return write.data;
  if (write.op === 'update' && isPlain(write.data)) return mergePatch(current ?? {}, write.data);
  return undefined;
}

/**
 * Refuses an agent's batch that the page would drop part of: a dataset id or
 * file name it ignores, a page file without its text, or a person's own
 * document (`data/users/…`, written by the open page only).
 */
export function dataWritesProblem(writes: readonly unknown[], read: (path: string) => unknown): WriteRefusal | null {
  for (const [index, write] of writes.entries()) {
    if (!isPlain(write)) continue;
    const named = write.path ?? (write.collection != null && write.doc_id != null ? `${String(write.collection)}/${String(write.doc_id)}` : '');
    let segments: string[];
    try {
      segments = splitPath(String(named), 'doc');
    } catch {
      continue;
    }
    const path = segments.join('/');
    const where = `writes[${index}]`;
    if (path.startsWith(`${USER_DATA_COLLECTION}/`))
      return { code: 'READ_ONLY_PATH', message: `${where}: ${path} is written by the open page; you only read it.` };
    if (segments.length !== 2) continue;
    const [collection, id] = segments as [string, string];
    if (collection === DATASETS_COLLECTION && !isValidDatasetId(id) && write.op !== 'delete')
      return { code: 'REFUSED', message: `${where}: datasets/${id}: a dataset id is 1–64 of A–Z a–z 0–9 _ - (the page ignores any other).` };
    if (collection !== FILES_COLLECTION || write.op === 'delete') continue;
    if (!isValidDashboardFilename(id))
      return { code: 'REFUSED', message: `${where}: files/${id}: a file name is letters, digits, _ - . (up to 64, no folders).` };
    const data = writtenData(write, read(path));
    if (data === undefined || !isPlain(data)) continue;
    if (typeof data.text !== 'string') return { code: 'REFUSED', message: `${where}: files/${id} needs {text}: the whole file as a string.` };
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > DOC_MAX_BYTES)
      return {
        code: 'TOO_LARGE',
        message: `${where}: files/${id} would be ${Math.ceil(bytes / 1024)} KB; the store refuses any document over 256 KB. Split it: a <script src> or <link href> naming another files/<name> loads it.`,
      };
  }
  return null;
}

/** What {@link refreshDataSnapshot} reads, writes and calls (the artifact's db and the owner's connectors). */
export interface DataRefreshDeps {
  /** One document, or `null`. */
  get(path: string): UnknownRecord | null;
  /** Every document of a collection, with its path. */
  list(collection: string): Array<{ path: string; data: UnknownRecord }>;
  /** Stores one batch (all or nothing); throws when the store refuses it. */
  write(writes: Array<{ op: 'set'; path: string; data: UnknownRecord } | { op: 'delete'; path: string }>): void | Promise<void>;
  /** Calls a connector's tool on this computer. */
  call(connector: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult>;
  now?: () => Date;
}

/** {@link refreshDataSnapshot}'s arguments, as the daemon sends them. */
export interface DataRefreshArgs {
  /** The owner's name, shown as "from <owner>'s computer". */
  owner?: unknown;
  /** Dataset ids to refresh; all live queries when left out. */
  queries?: unknown;
  /** Remove the snapshot instead (the owner took back publishing the data, or unpublished). */
  clear?: unknown;
}

const errorText = (error: unknown): string => {
  const text = isPlain(error) && typeof error.message === 'string' ? error.message : error instanceof Error ? error.message : String(error);
  return text.trim() || 'the connector did not answer';
};

/** The first text of a tool's error answer. */
const toolErrorText = (result: McpToolResult): string => {
  const text = result.content?.find((item) => typeof item?.text === 'string')?.text;
  return typeof text === 'string' && text.trim() ? text.trim().slice(0, 500) : 'the tool answered with an error';
};

/**
 * Takes the dashboard's live-data snapshot on this computer (the daemon's `open-artifact.data.refresh`): runs each
 * live query not kept local (`"snapshot": false`) at the stored filters through the owner's connectors, and keeps each
 * answer as its own document under `data/live/answers/` (see data-core's `live-snapshot.ts`). Each query is written
 * on its own, so one that fails, or whose answer is over the document limit, fails by name and keeps its last
 * answers while the others go through; `data/live` records when and why. Answers of datasets that are no longer live
 * queries are removed. `clear` removes the snapshot.
 */
export async function refreshDataSnapshot(deps: DataRefreshDeps, args: DataRefreshArgs = {}): Promise<DataRefreshResult> {
  const at = (deps.now?.() ?? new Date()).toISOString();
  const stored = deps.list(LIVE_SNAPSHOT_ANSWERS);
  if (args.clear === true) {
    const writes = [...stored.map((doc) => ({ op: 'delete' as const, path: doc.path })), ...(deps.get(LIVE_SNAPSHOT_PATH) ? [{ op: 'delete' as const, path: LIVE_SNAPSHOT_PATH }] : [])];
    if (writes.length) await deps.write(writes);
    return { at, refreshed: [], failed: [], cleared: true };
  }
  const owner = typeof args.owner === 'string' ? args.owner.slice(0, 200) : '';
  const only = Array.isArray(args.queries) ? args.queries.filter((item): item is string => typeof item === 'string') : undefined;
  const documents = new Map<string, UnknownRecord>();
  for (const path of ['dash/meta', 'dash/params', 'dash/settings', 'dash/look']) {
    const data = deps.get(path);
    if (data) documents.set(path, data);
  }
  for (const doc of deps.list(DATASETS_COLLECTION)) documents.set(doc.path, doc.data);
  const live = planLiveQueries(documents);
  const plans = only === undefined ? live : live.filter((plan) => only.includes(plan.id));
  const skipped = only === undefined ? [] : only.filter((id) => !live.some((plan) => plan.id === id));
  const refreshed: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  // Answers of datasets that are no longer live queries (removed, opted out, made a file) leave the snapshot.
  const gone = stored.filter((doc) => !live.some((plan) => liveSnapshotAnswerPath(plan.id) === doc.path));
  if (gone.length) await deps.write(gone.map((doc) => ({ op: 'delete' as const, path: doc.path })));
  for (const plan of plans) {
    const path = liveSnapshotAnswerPath(plan.id);
    const before = parseLiveSnapshotAnswer(deps.get(path));
    let reason: string | null = null;
    if (plan.problem !== undefined) reason = `Query "${plan.id}" can't run at the stored filters: ${plan.problem}`;
    else {
      let result: McpToolResult | null = null;
      try {
        result = await deps.call(plan.connector, plan.tool, plan.args);
      } catch (error) {
        reason = `Query "${plan.id}" (${plan.connector}): ${errorText(error)}`;
      }
      if (result !== null && result.isError === true) reason = `Query "${plan.id}" (${plan.connector}): ${toolErrorText(result)}`;
      else if (result !== null) {
        const { cache: _cache, ...answerResult } = result;
        const answer: LiveSnapshotAnswer = { at, connector: plan.connector, calls: [{ tool: plan.tool, args: plan.args, result: answerResult }] };
        reason = liveAnswerSizeProblem(plan.id, answer);
        if (reason === null) {
          try {
            await deps.write([{ op: 'set', path, data: answer as unknown as UnknownRecord }]);
            refreshed.push(plan.id);
            continue;
          } catch (error) {
            reason = `Query "${plan.id}": ${errorText(error)}`;
          }
        }
      }
    }
    failed.push({ id: plan.id, reason: reason ?? `Query "${plan.id}" failed.` });
    const kept: LiveSnapshotAnswer = { ...(before ?? { at: null, connector: plan.connector, calls: [] }), failed: { at, reason: reason ?? '' } };
    try {
      await deps.write([{ op: 'set', path, data: kept as unknown as UnknownRecord }]);
    } catch {
      // The last answers stay as they were; `data/live` still says why.
    }
  }
  const previous = parseLiveSnapshotStatus(deps.get(LIVE_SNAPSHOT_PATH));
  const status: LiveSnapshotStatus = {
    at: refreshed.length ? at : (previous?.at ?? null),
    owner: owner || previous?.owner || '',
    queries: live.map((plan) => plan.id),
  };
  if (failed.length) status.failed = { at, reason: failed.map((item) => item.reason).join(' '), queries: failed.map((item) => item.id) };
  await deps.write([{ op: 'set', path: LIVE_SNAPSHOT_PATH, data: status as unknown as UnknownRecord }]);
  return { at, refreshed, failed, ...(skipped.length ? { skipped } : {}) };
}
