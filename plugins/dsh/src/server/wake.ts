/**
 * Wake messages in DSH: a comment or request sent from an artifact's page reaches the agent of the session that owns
 * the artifact the way DSH delivers a finished job.
 *
 * - An idle agent is woken: the message starts a new turn (`followup`).
 * - A busy one reads it at its next step (`inject`).
 * - One waiting on the person's answer to its own question is not left waiting: the person answered on the page
 *   instead. A timed question ends as its timeout would ("pending", still answerable later) and the turn reads the
 *   message next; a blocking one ends with the turn, and the message starts the next.
 *
 * That last rule is for the owner only (`source.from.kind === 'owner'`). A collaborator's message and a task's result
 * are notices: they reach the agent the same way but leave its questions to the person open ({@link deliverNotice}).
 */
import { randomUUID } from 'node:crypto';
import { WAKE_SOURCE_KIND, type WakeDeliverStatus, type WakeSource } from '@open-artifact/protocol';
import type { DshAgent, DshQuestionWait, DshSessionEvent, DshUserMessage } from './dsh.ts';

/** DSH's tool for asking the person: an agent waiting on it is waiting on the person. */
export const QUESTION_TOOL = 'ask_user_question';

/** What {@link wakeMessage} takes: the text the daemon rendered and its structured copy. */
export interface WakeInput {
  text: string;
  source?: Partial<WakeSource> | null;
}

/** The wake as a frozen DSH user message, with the structured copy as its source (`form: notice`). */
export function wakeMessage({ text, source }: WakeInput): DshUserMessage {
  const firstLine = text.split('\n').find((line) => line !== '' && !line.startsWith('['));
  const summary = String(source?.summary ?? firstLine ?? text).slice(0, 200);
  const extra = source && typeof source === 'object' ? source : {};
  return Object.freeze({
    role: 'user' as const,
    id: randomUUID(),
    content: Object.freeze([Object.freeze({ type: 'text' as const, text })]),
    source: Object.freeze({ ...extra, kind: WAKE_SOURCE_KIND, form: 'notice' as const, summary }),
  });
}

/**
 * The questions each session's agent waits on the person for: `ask_user_question` calls without a result yet in the
 * current turn, from the session's own events. DSH tracks the blocking kind nowhere else.
 */
export class QuestionTracker {
  private readonly open = new WeakMap<object, Set<string>>();

  /** Takes one `session/event`. */
  observe(session: unknown, event: DshSessionEvent | undefined): void {
    if (!session || typeof session !== 'object' || !event) return;
    if (event.type === 'tool/call' && event.data?.name === QUESTION_TOOL && event.data.callId) {
      const calls = this.open.get(session) ?? new Set<string>();
      calls.add(event.data.callId);
      this.open.set(session, calls);
    } else if (event.type === 'tool/result') {
      const id = event.data?.message?.toolCallId ?? event.data?.callId;
      if (id) this.open.get(session)?.delete(id);
    } else if (event.type === 'turn/end') {
      this.open.delete(session);
    }
  }

  /** Whether the session's agent has a question to the person without an answer. */
  asking(session: object | undefined): boolean {
    return session !== undefined && (this.open.get(session)?.size ?? 0) > 0;
  }
}

/** The foreground waits of an agent's timed questions: those that can end as their timeout would. */
export function timedWaits(waits: Map<string, DshQuestionWait> | undefined): Array<Required<DshQuestionWait>> {
  if (!waits) return [];
  return [...waits.values()].filter(
    (wait): wait is Required<DshQuestionWait> => typeof wait?.close === 'function' && !!wait.timeout && typeof wait.timeout === 'object',
  );
}

/** What {@link deliverWake} needs to know about the agent's questions. */
export interface QuestionState {
  /** The agent waits on the person: an open question call, or a timed wait. */
  asking: boolean;
  /** End the timed waits as their timeouts would; false when there were none. */
  endTimedWaits(): boolean;
}

/**
 * Hands a message that is not the owner's to the agent: a collaborator's comment, or a task's result. DSH has one kind
 * of message for a turn, the user message (marked a notice here), so it goes in as that, but it never ends the
 * person's own questions the way the owner's words do: the agent reads it next, or a new turn starts when it is idle.
 * Whether to act on it is up to the agent; the text itself says who sent it and that they are not the owner.
 */
export function deliverNotice(agent: DshAgent, message: DshUserMessage): WakeDeliverStatus {
  if (agent.status === 'idle') {
    agent.followup(message);
    return 'resumed';
  }
  agent.inject(message);
  return 'delivered';
}

/** Whether a wake is the owner's own words: only those are handled as the person answering (see {@link deliverWake}). */
export function fromOwner(source: Pick<WakeSource, 'from'> | null | undefined): boolean {
  return source?.from?.kind === 'owner';
}

/** Hands the message to the agent; the status `wake.deliver` answers with. */
export function deliverWake(agent: DshAgent, message: DshUserMessage, questions: QuestionState): WakeDeliverStatus {
  if (agent.status === 'idle') {
    agent.followup(message);
    return 'resumed';
  }
  if (questions.asking) {
    if (questions.endTimedWaits()) {
      agent.inject(message);
      return 'resumed';
    }
    if (typeof agent.cancel === 'function') {
      agent.cancel({ kind: 'user' }, { keepInbox: true });
      agent.followup(message);
      return 'resumed';
    }
  }
  agent.inject(message);
  return 'delivered';
}
