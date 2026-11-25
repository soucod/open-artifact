/**
 * Who owns an artifact when sessions come and go. An artifact has one owner session; comments and requests wake only
 * it. Two things move it without an `adopt`:
 *
 * 1. **A wake answer that names another session** (`handOver`): the owner's adapter answered `wake.deliver` with
 *    `{ status, session }` (a thread that ended handed the message to its coordinator). That session, of the same
 *    harness, owns the artifact from then on, so later comments go straight to it.
 * 2. **A write by another session of the same harness and workspace** (`Ownership.wrote`: files or rows written through
 *    the tools, a type action whose effect is `write`, or files an adapter saw the agent write), when the owner is gone:
 *    not attached through an adapter, not resumable (no adapter of its harness resumes sessions, and its profile does
 *    not say `caps.wake.resume`), and not seen by a hook, call or attach for {@link ownerGoneMs}. The writer then owns
 *    it. While the owner is still there, the writer's next tool result says, once, that the artifact belongs to another
 *    session and that `adopt` takes it over.
 *
 * Never across harnesses or workspaces: an artifact made in one harness stays with its session there until an agent
 * adopts it. An artifact with no owner stays so (its wakes go to whichever session takes the shared inbox).
 */

import { actionKindOf, artifactIdOf, artifactUrl, type SessionRef, type ToolCallResult } from '@open-artifact/protocol';
import { samePath } from './paths.ts';
import { sessionKeyOf, type ArtifactStore } from './store.ts';

/** How long a session not seen counts as gone, ms: `$OPEN_ARTIFACT_OWNER_GONE_MS`, else two hours. */
export function ownerGoneMs(): number {
  const fromEnv = Number(process.env.OPEN_ARTIFACT_OWNER_GONE_MS);
  return Number.isFinite(fromEnv) && fromEnv >= 0 && process.env.OPEN_ARTIFACT_OWNER_GONE_MS ? fromEnv : 2 * 60 * 60_000;
}

/** What ownership needs of the Harness hub. */
export interface OwnershipHub {
  statusOf(ref: SessionRef | null | undefined): { live: boolean };
  resumes(harness: string): boolean;
  seenAt(ref: SessionRef | null | undefined): number | null;
  workspaceOf(ref: SessionRef): string | null;
}

/** Options of {@link Ownership}. */
export interface OwnershipOptions {
  store: ArtifactStore;
  hub: () => OwnershipHub | null;
  log: (line: string) => void;
}

/**
 * Hands an artifact to `session` of `from`'s harness, after `from`'s adapter answered a wake with it. Returns the new
 * owner, or `null` when nothing changed (the artifact is gone, or its owner is no longer `from`).
 */
export function handOver(store: ArtifactStore, id: string, from: SessionRef, session: string, log: (line: string) => void): SessionRef | null {
  const record = store.get(id);
  if (!record?.owner || sessionKeyOf(record.owner) !== sessionKeyOf(from) || session === from.session) return null;
  const owner: SessionRef = { harness: from.harness, session, workspace: from.workspace ?? null };
  store.update(id, { owner });
  log(`owner of ${id}: ${sessionKeyOf(from)} -> ${sessionKeyOf(owner)} (the wake was handed over)`);
  return owner;
}

/** What a write by another session than the owner did. */
export interface WriteOutcome {
  /** The writer owns the artifact now. */
  moved: boolean;
  /** One line for the writer's next tool result, or `null`. */
  note: string | null;
}

/**
 * Moves ownership on writes (see the file comment). The writes that count: files with `Artifact publish`, rows with
 * `ArtifactData`, a type action whose effect is `write` (`Artifact call`, as Sheets and Docs are written), and files
 * an adapter saw the agent write (`agent.wrote`, as project-file types are written).
 */
export class Ownership {
  private readonly options: OwnershipOptions;
  /** `<artifact>|<writer key>` already told the artifact belongs to another session. */
  private readonly told = new Set<string>();
  /** Lines waiting for a session's next tool result, by session key. */
  private readonly notes = new Map<string, string[]>();

  constructor(options: OwnershipOptions) {
    this.options = options;
  }

  /** Whether `owner` can still be reached: attached, resumable, or seen lately. */
  present(owner: SessionRef): boolean {
    const hub = this.options.hub();
    if (!hub) return true;
    if (hub.statusOf(owner).live || hub.resumes(owner.harness)) return true;
    const seen = hub.seenAt(owner);
    return seen !== null && Date.now() - seen < ownerGoneMs();
  }

  /**
   * The session `writer` wrote artifact `id`: moves it to the writer when its owner is gone, else says (once) whose it
   * is. The line waits for the writer's next tool result ({@link afterTool}).
   */
  wrote(id: string, writer: SessionRef): WriteOutcome {
    const outcome = this.judge(id, writer);
    const key = sessionKeyOf(writer);
    if (outcome.note && key) this.notes.set(key, [...(this.notes.get(key) ?? []), outcome.note]);
    return outcome;
  }

  private judge(id: string, writer: SessionRef): WriteOutcome {
    const none: WriteOutcome = { moved: false, note: null };
    const record = this.options.store.get(id);
    const owner = record?.owner;
    const writerKey = sessionKeyOf(writer);
    if (!record || !owner || !writerKey || sessionKeyOf(owner) === writerKey) return none;
    const hub = this.options.hub();
    const ownerWorkspace = owner.workspace ?? hub?.workspaceOf(owner) ?? null;
    const writerWorkspace = writer.workspace ?? hub?.workspaceOf(writer) ?? null;
    const sameHarness = writer.harness === owner.harness;
    const sameWorkspace = !!ownerWorkspace && !!writerWorkspace && samePath(ownerWorkspace, writerWorkspace);
    if (sameHarness && sameWorkspace && writer.session && !this.present(owner)) {
      const next: SessionRef = { harness: writer.harness, session: writer.session, workspace: writerWorkspace };
      this.options.store.update(id, { owner: next });
      this.options.log(`owner of ${id}: ${sessionKeyOf(owner)} -> ${writerKey} (its session is gone; another one of ${writer.harness} wrote it)`);
      return { moved: true, note: `Its earlier session is gone, so ${artifactUrl(id)} is yours now: comments on it come to this session.` };
    }
    const toldKey = `${id}|${writerKey}`;
    if (this.told.has(toldKey)) return none;
    this.told.add(toldKey);
    return {
      moved: false,
      note: `${artifactUrl(id)} belongs to another session (${sessionKeyOf(owner)}): comments on it go there. To take it over, call Artifact {action: "adopt", url: "${artifactUrl(id)}"}.`,
    };
  }

  /**
   * After a tool call: when it wrote files with `Artifact publish` or rows with `ArtifactData`, applies {@link wrote};
   * then adds every line waiting for the caller (from those, a write action, or `agent.wrote`) to the result's `notes`.
   */
  afterTool(name: string, args: Record<string, unknown>, caller: SessionRef, result: ToolCallResult): ToolCallResult {
    if (!result || typeof result !== 'object') return result;
    if (!('error' in result && result.error)) {
      const action = typeof args.action === 'string' ? args.action : name === 'Artifact' ? 'publish' : '';
      const wroteFiles = name === 'Artifact' && action === 'publish' && typeof args.url === 'string' && Array.isArray(result.written);
      const wroteRows = name === 'ArtifactData' && actionKindOf('ArtifactData', action) === 'write';
      const id = wroteFiles || wroteRows ? artifactIdOf(String((result.url as string | undefined) ?? args.url ?? '')) : null;
      if (id) this.wrote(id, caller);
    }
    const key = sessionKeyOf(caller);
    const waiting = key ? this.notes.get(key) : undefined;
    if (!key || !waiting?.length) return result;
    this.notes.delete(key);
    const notes = Array.isArray(result.notes) ? result.notes : [];
    return { ...result, notes: [...notes, ...waiting] };
  }
}
