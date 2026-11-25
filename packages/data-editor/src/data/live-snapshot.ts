/**
 * The live-data snapshot on a page that cannot call connectors (every page a cloud host serves): the answers the
 * owner's computer took for the dashboard's live queries, kept in the store under `data/live` (see data-core's
 * `live-snapshot.ts`). The tool client falls back to them when the page has no `mcp` capability, so the figures come
 * through the same readers and loaders as a live answer. A call they don't hold stays "not available in this view".
 *
 * The owner (and an editor the owner lets ask the agent) can ask for a refresh: `POST _api/data/refresh` queues it for
 * the owner's linked computer, which runs the queries and pushes new answers; the page hears them as store changes and
 * runs its queries again, so the figures move without a reload.
 */

import { create } from 'zustand';
import type { DbCapability, DbChangeEvent } from '@open-artifact/runtime';
import {
  LIVE_SNAPSHOT_ANSWERS,
  LIVE_SNAPSHOT_PATH,
  findSnapshotCall,
  isLiveSnapshotPath,
  parseLiveSnapshotAnswer,
  parseLiveSnapshotStatus,
  type LiveSnapshotAnswer,
  type LiveSnapshotStatus,
  type McpToolResult,
  type UnknownRecord,
} from '@open-artifact/data-core';
import type { McpToolClient } from './mcp.ts';

/** How a refresh the page asked for stands. */
export type SnapshotAsk = { kind: 'idle' } | { kind: 'sending' } | { kind: 'waiting'; online: boolean; at: string | null } | { kind: 'failed'; message: string };

export interface LiveSnapshotState {
  /** `data/live`, once read; `null` when there is no snapshot. */
  status: LiveSnapshotStatus | null;
  /** The page used the snapshot for at least one answer (it has no connectors). */
  inUse: boolean;
  ask: SnapshotAsk;
}

/** What the page knows of the snapshot (the toolbar's "Data as of" line and Refresh). */
export const useLiveSnapshot = create<LiveSnapshotState>(() => ({ status: null, inUse: false, ask: { kind: 'idle' } }));

/** The snapshot as the tool client reads it. */
export interface LiveSnapshotSource {
  /** The recorded answer of this call, or `null`. Reads the store the first time. */
  find(connector: string, tool: string, args: UnknownRecord): Promise<{ result: McpToolResult; at: string | null } | null>;
  /** Hears the snapshot change (new answers pushed); returns a stop function. */
  subscribe(listener: () => void): () => void;
  dispose(): void;
}

/** Reads the snapshot from the store and follows its changes. */
export function createLiveSnapshotSource(db: () => DbCapability | null): LiveSnapshotSource {
  const answers = new Map<string, LiveSnapshotAnswer>();
  let status: LiveSnapshotStatus | null = null;
  let loading: Promise<void> | null = null;
  let stop: (() => void) | null = null;
  const listeners = new Set<() => void>();
  let notifyScheduled = false;

  const publish = (): void => useLiveSnapshot.setState({ status });
  const notify = (): void => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      for (const listener of [...listeners]) listener();
    });
  };
  const onChange = (event: DbChangeEvent): void => {
    let changed = false;
    for (const [path, data] of Object.entries(event.changes)) {
      if (!isLiveSnapshotPath(path)) continue;
      changed = true;
      if (path === LIVE_SNAPSHOT_PATH) status = data === null ? null : parseLiveSnapshotStatus(data);
      else {
        const answer = data === null ? null : parseLiveSnapshotAnswer(data);
        if (answer === null) answers.delete(path);
        else answers.set(path, answer);
      }
    }
    if (!changed) return;
    publish();
    // The status is a refresh's last write: the page asked, and the refresh is done (its answers, or why it failed).
    if (useLiveSnapshot.getState().ask.kind === 'waiting' && Object.hasOwn(event.changes, LIVE_SNAPSHOT_PATH)) useLiveSnapshot.setState({ ask: { kind: 'idle' } });
    notify();
  };
  const load = (): Promise<void> => {
    const store = db();
    if (store === null) return Promise.resolve();
    loading ??= (async () => {
      stop ??= store.onChange(onChange);
      const [head, list] = await Promise.all([store.get(LIVE_SNAPSHOT_PATH).catch(() => null), store.list(LIVE_SNAPSHOT_ANSWERS).catch(() => [])]);
      status = parseLiveSnapshotStatus(head);
      for (const doc of list) {
        const answer = parseLiveSnapshotAnswer(doc.data);
        if (answer !== null && !answers.has(doc.path)) answers.set(doc.path, answer);
      }
      publish();
    })();
    return loading;
  };
  return {
    async find(connector, tool, args) {
      await load();
      return findSnapshotCall(answers.values(), connector, tool, args);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stop?.();
      stop = null;
      listeners.clear();
    },
  };
}

/**
 * The tool client with the snapshot behind it: while the page has no `mcp` capability, a call the snapshot holds is
 * answered from it (marked as a stored answer of when it was taken); every other call goes as it would.
 */
export function withLiveSnapshot(client: McpToolClient, hasMcp: () => boolean, snapshot: LiveSnapshotSource): McpToolClient {
  return {
    ...client,
    async call(connector, tool, args, options) {
      if (hasMcp()) return client.call(connector, tool, args, options);
      const found = await snapshot.find(connector, tool, args).catch(() => null);
      if (found === null) return client.call(connector, tool, args, options);
      if (!useLiveSnapshot.getState().inUse) useLiveSnapshot.setState({ inUse: true });
      const storedAt = found.at === null ? Number.NaN : Date.parse(found.at);
      return { ...structuredClone(found.result), ...(Number.isFinite(storedAt) ? { cache: { storedAt } } : {}) };
    },
  };
}

/* ---- words (English and Chinese, by the browser's language) ------------------------------------------------------ */

const chinese = (): boolean => /^zh\b/i.test(globalThis.navigator?.language ?? '');

/** When the answers were taken, in the viewer's words. */
export function formatSnapshotTime(at: string, locale = globalThis.navigator?.language): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return at;
  try {
    return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return date.toISOString();
  }
}

/** "Data as of <time>, from <owner>'s computer". */
export function snapshotLine(status: LiveSnapshotStatus, zh = chinese()): string | null {
  if (status.at === null) return null;
  const time = formatSnapshotTime(status.at);
  if (zh) return `数据截至 ${time}，来自${status.owner ? ` ${status.owner} 的` : '所有者的'}电脑`;
  return `Data as of ${time}, from ${status.owner ? `${status.owner}’s` : 'the owner’s'} computer`;
}

/** "couldn't refresh: <reason>" (the owner's alone). */
export function snapshotFailure(status: LiveSnapshotStatus, zh = chinese()): string | null {
  if (status.failed === undefined) return null;
  return zh ? `刷新失败：${status.failed.reason}` : `couldn’t refresh: ${status.failed.reason}`;
}

/** The refresh control's words. */
export function snapshotWords(owner: string, zh = chinese()): { label: string; tip: string; sending: string; waiting: string; offline: string } {
  const who = owner || (zh ? '所有者' : 'the owner');
  return zh
    ? {
        label: '刷新',
        tip: `请 ${who} 的电脑重新运行实时查询。`,
        sending: '正在请求刷新…',
        waiting: `正在 ${who} 的电脑上刷新…`,
        offline: `${who} 的电脑现在不在线：刷新请求会等它上线后执行。`,
      }
    : {
        label: 'Refresh',
        tip: `Ask ${owner ? `${owner}’s` : 'the owner’s'} computer to run the live queries again.`,
        sending: 'Asking for a refresh…',
        waiting: `Refreshing on ${owner ? `${owner}’s` : 'the owner’s'} computer…`,
        offline: `${owner ? `${owner}’s` : 'The owner’s'} computer isn’t online: the refresh waits until it is.`,
      };
}

/** Asks the owner's computer for a refresh (`POST _api/data/refresh` beside the page). */
export async function askSnapshotRefresh(queries?: readonly string[], fetcher: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<void> {
  useLiveSnapshot.setState({ ask: { kind: 'sending' } });
  try {
    const response = await fetcher(new URL('_api/data/refresh', globalThis.location?.href).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(queries === undefined ? {} : { queries }),
    });
    const body = (await response.json().catch(() => ({}))) as { online?: unknown; message?: unknown };
    if (!response.ok) throw new Error(typeof body.message === 'string' ? body.message : `HTTP ${response.status}`);
    useLiveSnapshot.setState({ ask: { kind: 'waiting', online: body.online === true, at: useLiveSnapshot.getState().status?.at ?? null } });
  } catch (error) {
    useLiveSnapshot.setState({ ask: { kind: 'failed', message: error instanceof Error ? error.message : String(error) } });
  }
}
