/**
 * The chat cards of what a person sends to the agent from an artifact. The daemon's wake carries a structured copy of
 * the event (`WakeSource`, kind `open-artifact.event`), and the server half hands it to the agent as a user message
 * with that source (src/server/wake.ts). Here that message is claimed from the conversation, so the app does not draw
 * it as a plain context row, and drawn on the person's side of the chat (components/EventCards.tsx):
 *
 *   Comment on "Q3 results" sent to agent      ▾
 *   Make the title shorter
 *   Board "Home" › Title
 *   View thread ›
 *
 * A request from one of the page's buttons gets a card of its own, the header and its words; a message from the
 * Shell's chat (a request without a label, id `ask_…`) is one too. Words from someone other than the owner say who
 * sent them (`source.from`), and the result of a task the agent started (`source.task`) gets a card of its own.
 */
import { WAKE_SOURCE_KIND } from '@open-artifact/protocol';

/** One comment thread of a card. */
export interface CardThread {
  id: string;
  where: string;
  text: string;
}

/** One request of a card. */
export interface CardRequest {
  id: string;
  label: string;
  text: string;
}

/** What a card draws. */
export interface CardData {
  title: string;
  /** The artifact's id in the library: from another device the thread opens through the open route, which needs it. */
  artifactId: string;
  /** The Shell's address when the comments came. */
  viewUrl: string;
  threads: CardThread[];
  requests: CardRequest[];
  /** Someone other than the owner sent it: their name and role on the artifact. */
  from: { name: string; role: string } | null;
  /** A task's result: what it did and whether it worked. */
  task: { action: string; ok: boolean } | null;
  seq: number;
}

/** A session event, as far as the cards read one. */
export interface SessionEventLike {
  type: string;
  seq: number;
  surfaceOp?: unknown;
  data?: { id?: unknown; source?: Record<string, unknown> };
}

const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Whether the event is a wake message of ours, as it is added to the chat. */
export function isWakeEvent(event: SessionEventLike): boolean {
  return event.type === 'user/message' && event.surfaceOp === 'append' && event.data?.source?.kind === WAKE_SOURCE_KIND;
}

/** The sender, when it is a collaborator rather than the owner. */
function fromOf(value: unknown): CardData['from'] {
  const from = value as { kind?: unknown; name?: unknown; role?: unknown } | null;
  return from && typeof from === 'object' && from.kind === 'collaborator' ? { name: str(from.name) || '?', role: str(from.role) } : null;
}

/** The task a result is about. */
function taskOf(value: unknown): CardData['task'] {
  const task = value as { action?: unknown; ok?: unknown } | null;
  return task && typeof task === 'object' ? { action: str(task.action), ok: task.ok !== false } : null;
}

/** The card's data, from the message's source. */
export function cardData(event: SessionEventLike): CardData {
  const source = event.data?.source ?? {};
  const threads = Array.isArray(source.threads) ? (source.threads as Record<string, unknown>[]) : [];
  const requests = Array.isArray(source.requests) ? (source.requests as Record<string, unknown>[]) : [];
  return {
    title: str(source.title),
    artifactId: str(source.artifactId),
    viewUrl: str(source.viewUrl),
    threads: threads.map((t) => ({ id: str(t.id), where: str(t.where), text: str(t.text) })).filter((t) => t.id),
    requests: requests.map((r) => ({ id: str(r.id), label: str(r.label), text: str(r.text) })).filter((r) => r.id && r.text),
    from: fromOf(source.from),
    task: taskOf(source.task),
    seq: event.seq,
  };
}

/** A message from the Shell's chat: a request without a label. */
export function isShellMessage(request: CardRequest): boolean {
  return !request.label && request.id.startsWith('ask_');
}

/** The Shell's address at one comment: the Shell hands `?comment=` to the page, whose comments layer opens the thread. */
export function threadUrl(url: string, id: string): string {
  try {
    const at = new URL(url);
    at.searchParams.set('comment', id);
    return at.href;
  } catch {
    return url;
  }
}

interface NodeContext {
  key: string;
  id: string;
  state: CardData | undefined;
  start?: { location: unknown };
  matches: Array<{ location: unknown }>;
}

/** The conversation definition that claims a wake message and makes a chat node of it. */
export function cardDefinition(kind: string) {
  return {
    kind,
    target: 'chat',
    match: (event: SessionEventLike) =>
      // Claimed: the built-in input-message definition would draw it as a context row.
      isWakeEvent(event) ? { id: String(event.data?.id), role: 'start' as const, exclusive: true as const } : null,
    start: (_context: unknown, match: { event: SessionEventLike }) => cardData(match.event),
    update: (context: NodeContext) => context.state,
    buildViewNode: (context: NodeContext) => {
      if (context.state === undefined) return null;
      return {
        key: context.key,
        kind,
        id: context.id,
        target: 'chat',
        anchorSeq: context.state.seq,
        location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
        visibility: 'visible',
        // A person's input, as a user message: it opens the agent's reply below it.
        groupTree: 'input',
        data: context.state,
      };
    },
  };
}
