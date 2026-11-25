/**
 * `view.context`: what the person has selected on an artifact's page, for the session's next turn.
 *
 * The answer comes from the type's own `context` action, called the way the agent's Artifact `call` calls it (so a
 * URL-entry type served elsewhere answers it too); a type without that action answers `{ at: null, context: null }`.
 * Only the artifact's owner session may read it. `changed` says the person edited the artifact on the page since an
 * agent last read or wrote it (kept per artifact, not per session).
 *
 * `view/context` events are best effort: a local type server reports a change of the owner's context
 * (`POST /api/open-artifact.type.context`) and subscribed adapters hear of it at most once a {@link CONTEXT_EVENT_MS};
 * a URL-entry type has no such channel, so for it the event may never come.
 */

import { OpenArtifactError, artifactUrl, type SessionRef, type ViewContextResult, type ViewContextEvent } from '@open-artifact/protocol';
import { sessionKeyOf } from './store.ts';

/** The methods this module answers. */
export const VIEW_METHODS = ['view.context'] as const;

/** Least time between two `view/context` events of one artifact, ms. */
export const CONTEXT_EVENT_MS = 1000;

/** What the handler is given about the calling adapter. */
export interface ViewCallContext {
  harness: string;
  caller: SessionRef;
  /** The hub's view contexts. */
  contexts: ViewContexts;
}

/** Answers `view.context`. */
export async function handleViewCall(_method: (typeof VIEW_METHODS)[number], params: Record<string, unknown>, context: ViewCallContext): Promise<unknown> {
  const caller: SessionRef = typeof params.session === 'string' && params.session ? { ...context.caller, session: params.session } : context.caller;
  return context.contexts.read(String(params.url ?? ''), caller);
}

/** An artifact as `view.context` needs it. */
export interface ViewRecord {
  id: string;
  owner: SessionRef | null;
  lastUserEditAt?: string | null;
  agentSeenAt?: string | null;
}

/** How {@link ViewContexts} reaches the rest of the daemon (the daemon sets it). */
export interface ViewContextSource {
  /** The artifact of an address or id; throws `not_found`. */
  record: (url: string) => ViewRecord;
  /** The type's `context` action on this artifact, the agent's way; `null` when the type has no such action. */
  context: (record: ViewRecord) => Promise<unknown | null>;
}

/** Reads view contexts for owner sessions and tells subscribed adapters when one changes. */
export class ViewContexts {
  private source: ViewContextSource | null = null;
  private readonly broadcast: (event: ViewContextEvent) => void;
  private readonly now: () => number;
  /** Per artifact: when the last event went, and the one waiting to go. */
  private readonly pending = new Map<string, { sent: number; timer: ReturnType<typeof setTimeout> | null; at: string }>();

  constructor(options: { broadcast: (event: ViewContextEvent) => void; now?: () => number }) {
    this.broadcast = options.broadcast;
    this.now = options.now ?? Date.now;
  }

  configure(source: ViewContextSource): void {
    this.source = source;
  }

  /** `view.context` for `caller`: only the artifact's owner session reads it. */
  async read(url: string, caller: SessionRef): Promise<ViewContextResult> {
    if (!this.source) throw new OpenArtifactError('unsupported', 'view.context is not ready.');
    if (!url) throw new OpenArtifactError('invalid_argument', 'view.context needs url.');
    const record = this.source.record(url);
    const owner = record.owner ? sessionKeyOf(record.owner) : null;
    if (!owner || owner !== sessionKeyOf(caller)) throw new OpenArtifactError('not_granted', 'Only the session that owns the artifact reads its view context.');
    const changed = !!record.lastUserEditAt && (!record.agentSeenAt || record.lastUserEditAt > record.agentSeenAt);
    const out = await this.source.context(record);
    const body = out && typeof out === 'object' && !Array.isArray(out) ? (out as Record<string, unknown>) : null;
    if (!body) return { at: null, context: null, changed };
    return { at: typeof body.at === 'string' ? body.at : null, context: body.context ?? null, changed };
  }

  /** A type server says the owner's view context of artifact `id` changed: an event, throttled per artifact. */
  noted(id: string, at: string): void {
    const now = this.now();
    const entry = this.pending.get(id) ?? { sent: 0, timer: null, at };
    entry.at = typeof at === 'string' && at ? at.slice(0, 40) : new Date(now).toISOString();
    this.pending.set(id, entry);
    if (entry.timer) return;
    const send = (): void => {
      entry.timer = null;
      entry.sent = this.now();
      this.broadcast({ type: 'view/context', url: artifactUrl(id), id, at: entry.at });
    };
    const wait = entry.sent + CONTEXT_EVENT_MS - now;
    if (wait <= 0) send();
    else {
      entry.timer = setTimeout(send, wait);
      entry.timer.unref?.();
    }
  }

  close(): void {
    for (const entry of this.pending.values()) if (entry.timer) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
