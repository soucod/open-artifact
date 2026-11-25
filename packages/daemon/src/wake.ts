/**
 * The wake router: comments and page requests sent to the agent find the
 * artifact's owner session. Messages for one artifact that arrive within the
 * merge window go out as one wake, rendered by the protocol's
 * `wakeMessage`, and are delivered:
 *
 * 1. **live**: the owner's adapter is connected and takes `wake.deliver`;
 * 2. **inbox**: queued for the session, taken when it attaches, on its next
 *    tool call, or by a wait (which takes it at once: `via: 'wait'`). A
 *    session whose harness hands over its inbox only while a turn runs is then
 *    nudged (`nudge`), which starts a turn there.
 *
 * An adapter's answer counts as delivered unless it is `failed`: `drafted` (put in the session's draft for the person
 * to send) too, so it never also goes to the inbox. When the answer names another session that took it (a thread that
 * ended handed it to its coordinator), that session of the same harness becomes the artifact's owner (`handOver` in
 * `ownership.ts`), and later wakes go straight to it.
 */

import {
  OpenArtifactError,
  WAKE_MERGE_MS,
  WAKE_PER_MINUTE,
  artifactUrl,
  wakeMessage,
  type LibraryEvent,
  type SessionRef,
  type WakeDeliverResult,
  type WakeDeliverStatus,
  type WakePayload,
  type WakeRequestItem,
  type WakeThread,
  type WakeVia,
} from '@open-artifact/protocol';
import type { Inbox } from './inbox.ts';
import { handOver } from './ownership.ts';
import { sessionKeyOf, type ArtifactStore } from './store.ts';

/** Session key of the inbox that takes wakes of artifacts with no owner. */
export const UNOWNED_KEY = 'unowned';

/**
 * How long a nudge counts as still on its way, ms: while it is and the session has not taken its inbox, another wake
 * joins that inbox without a nudge of its own (the turn the first one starts hands over every waiting message).
 */
export const NUDGE_REPEAT_MS = 5 * 60_000;

/** How one wake ended up. */
export interface WakeResult {
  via: WakeVia;
  /** The adapter's answer, for `live`. */
  status?: WakeDeliverStatus;
  /** The session that took it, for `live`, when the adapter named another one than the target. */
  session?: string;
}

/** What delivers a wake live: the Harness hub. */
export interface LiveDelivery {
  /** The adapter's answer (a status, or a status and the session that took it), or `null` when no adapter can take it. */
  deliver(ref: SessionRef, payload: WakePayload): Promise<WakeDeliverResult | WakeDeliverStatus | null>;
}

const STATUSES = new Set<WakeDeliverStatus>(['delivered', 'resumed', 'queued', 'drafted', 'failed']);

/** An adapter's answer, checked: a known status, and a session id when it names one. */
export function deliverAnswer(answer: unknown): WakeDeliverResult | null {
  const raw = typeof answer === 'string' ? { status: answer } : answer && typeof answer === 'object' ? (answer as Record<string, unknown>) : null;
  if (!raw || !STATUSES.has(raw.status as WakeDeliverStatus)) return null;
  const session = typeof raw.session === 'string' && raw.session.length > 0 && raw.session.length <= 256 && !/[\x00-\x1f]/.test(raw.session) ? raw.session : null;
  return { status: raw.status as WakeDeliverStatus, ...(session ? { session } : {}) };
}

/** Options of {@link WakeRouter}. */
export interface WakeRouterOptions {
  store: ArtifactStore;
  inbox: Inbox;
  /** Live delivery; `null` until the hub exists. */
  live: () => LiveDelivery | null;
  /** The Shell address of an artifact. */
  viewUrl: (id: string) => string;
  log: (line: string) => void;
  emit?: (event: LibraryEvent) => void;
  /** Wakes an idle session after its wake went to the inbox (see `nudge.ts`); not awaited. */
  nudge?: (target: SessionRef, payload: WakePayload) => void;
  /** Merge window, ms. Default `$OPEN_ARTIFACT_WAKE_MERGE_MS`, else the protocol's. */
  mergeMs?: number;
}

/** One queued item. */
export type WakeItem = { thread: WakeThread } | { request: WakeRequestItem };

interface Pending {
  threads: Map<string, WakeThread>;
  requests: WakeRequestItem[];
  timer: ReturnType<typeof setTimeout> | undefined;
  waiters: Array<(result: WakeResult) => void>;
}

/** Merges and routes wakes. */
export class WakeRouter {
  private readonly options: WakeRouterOptions;
  private readonly pending = new Map<string, Pending>();
  /** Send times in the last minute, by artifact id. */
  private readonly sent = new Map<string, number[]>();
  /** When each session key was last nudged. */
  private readonly nudged = new Map<string, number>();

  constructor(options: WakeRouterOptions) {
    this.options = options;
  }

  private get mergeMs(): number {
    if (this.options.mergeMs !== undefined) return this.options.mergeMs;
    const fromEnv = Number(process.env.OPEN_ARTIFACT_WAKE_MERGE_MS);
    return Number.isFinite(fromEnv) && process.env.OPEN_ARTIFACT_WAKE_MERGE_MS ? fromEnv : WAKE_MERGE_MS;
  }

  /** The person asked from the Shell or the home page. */
  ask(id: string, text: string, label?: string): Promise<WakeResult> {
    const request: WakeRequestItem = { id: `ask_${Date.now().toString(36)}`, text, sentAt: new Date().toISOString() };
    if (label) request.label = label;
    return this.queue(id, { request });
  }

  /** Queues a thread or request; resolves once the merged wake was routed. Throws `rate_limited`. */
  queue(id: string, item: WakeItem): Promise<WakeResult> {
    const recent = (this.sent.get(id) ?? []).filter((t) => Date.now() - t < 60_000);
    if (recent.length >= WAKE_PER_MINUTE) {
      throw new OpenArtifactError('rate_limited', 'Too many messages to the agent from this artifact in the last minute.', { status: 429 });
    }
    let pending = this.pending.get(id);
    if (!pending) this.pending.set(id, (pending = { threads: new Map(), requests: [], timer: undefined, waiters: [] }));
    if ('thread' in item) pending.threads.set(item.thread.id, item.thread);
    else pending.requests.push(item.request);
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => void this.flush(id), this.mergeMs);
    pending.timer.unref?.();
    const waiters = pending.waiters;
    return new Promise((resolveQueue) => waiters.push(resolveQueue));
  }

  private async flush(id: string): Promise<void> {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    const recent = (this.sent.get(id) ?? []).filter((t) => Date.now() - t < 60_000);
    recent.push(Date.now());
    this.sent.set(id, recent);
    let result: WakeResult;
    try {
      result = await this.deliver(id, [...pending.threads.values()], pending.requests);
    } catch (error) {
      this.options.log(`wake ${id} failed: ${(error as Error)?.stack ?? error}`);
      result = { via: 'failed' };
    }
    for (const done of pending.waiters) done(result);
  }

  /** Renders and routes one merged wake. */
  async deliver(id: string, threads: WakeThread[], requests: WakeRequestItem[]): Promise<WakeResult> {
    const record = this.options.store.get(id);
    if (!record) return { via: 'dropped' };
    const owner = record.owner;
    const message = wakeMessage(record, threads, requests, { viewUrl: this.options.viewUrl(id), noOwner: !owner });
    const payload: WakePayload = { artifact: artifactUrl(id), artifactId: id, text: message.text, source: message.source };
    const result = await this.send(owner, payload);
    // The adapter handed it to another session of the harness: that one owns the artifact from now on.
    if (owner && result.session) handOver(this.options.store, id, owner, result.session, this.options.log);
    return result;
  }

  /**
   * Delivers a rendered message to one session: live when its adapter takes
   * it, else into its inbox (the unowned inbox when `target` is `null`).
   * Wakes go to the owner; a finished long action goes to the caller that
   * started it.
   */
  async send(target: SessionRef | null, payload: WakePayload): Promise<WakeResult> {
    const { inbox, log, emit } = this.options;
    const id = payload.artifactId;
    const live = this.options.live();
    if (target && live) {
      const answer = deliverAnswer(
        await live.deliver(target, payload).catch((error: unknown) => {
          log(`wake.deliver to ${sessionKeyOf(target)}: ${(error as Error)?.message ?? error}`);
          return null;
        }),
      );
      const status = answer?.status;
      if (status && status !== 'failed') {
        const session = answer.session && answer.session !== target.session ? answer.session : undefined;
        log(`wake ${id} -> ${sessionKeyOf(target)} (${status}${session ? `, taken by ${session}` : ''})`);
        emit?.({ type: 'wake/state', artifactId: id, via: 'live', status });
        return { via: 'live', status, ...(session ? { session } : {}) };
      }
    }
    const key = (target && sessionKeyOf(target)) || UNOWNED_KEY;
    const waiting = inbox.count(key) > 0;
    const { taken } = inbox.append(key, { kind: 'wake', ...payload });
    log(`wake ${id} -> inbox ${key}${taken ? ' (taken by a wait)' : ''}`);
    if (!taken && target && this.options.nudge) {
      // A nudge still on its way starts a turn that takes this message too; a second one would only queue an empty turn.
      const last = this.nudged.get(key);
      if (waiting && last !== undefined && Date.now() - last < NUDGE_REPEAT_MS) {
        log(`wake ${id}: ${key} already nudged; joins its inbox`);
      } else {
        this.nudged.set(key, Date.now());
        this.options.nudge(target, payload);
      }
    }
    const via: WakeVia = taken ? 'wait' : 'inbox';
    emit?.({ type: 'wake/state', artifactId: id, via });
    return { via };
  }
}
